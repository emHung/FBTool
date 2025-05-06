const express = require('express');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// Biến lưu trữ browser và page
let globalBrowser = null;
let globalPage = null;

// Route để render trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hàm kiểm tra trạng thái đăng nhập
async function checkLoginStatus(page) {
    try {
        // Kiểm tra URL
        const currentUrl = page.url();
        if (currentUrl.includes('facebook.com/home') || currentUrl.includes('/?')) {
            return true;
        }

        // Kiểm tra các phần tử UI đặc trưng của trạng thái đã đăng nhập
        const isLoggedIn = await page.evaluate(() => {
            return (
                document.querySelector('[data-pagelet="LeftRail"]') !== null ||
                document.querySelector('div[role="banner"]') !== null ||
                document.querySelector('div[aria-label="Tài khoản"]') !== null ||
                document.querySelector('div[aria-label="Account"]') !== null ||
                document.querySelector('div[data-pagelet="Stories"]') !== null
            );
        });

        return isLoggedIn;
    } catch (error) {
        console.error('Lỗi kiểm tra đăng nhập:', error);
        return false;
    }
}

// Hàm delay
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// API endpoint để thực hiện đăng nhập bằng cookie
app.post('/login', async (req, res) => {
    try {
        const { cookies } = req.body;
        
        // Kiểm tra và định dạng lại cookies
        const formattedCookies = cookies.map(cookie => ({
            ...cookie,
            domain: '.facebook.com',
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'Strict'
        }));

        // Nếu browser đã tồn tại, đóng nó
        if (globalBrowser) {
            await globalBrowser.close();
            globalBrowser = null;
            globalPage = null;
        }

        // Khởi tạo browser mới
        globalBrowser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-notifications'
            ]
        });
        
        globalPage = await globalBrowser.newPage();
        
        // Set user agent
        await globalPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Truy cập Facebook
        await globalPage.goto('https://www.facebook.com', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // Thử đăng nhập tối đa 3 lần
        let loginSuccess = false;
        let attempts = 0;

        while (!loginSuccess && attempts < 3) {
            attempts++;
            console.log(`Thử đăng nhập lần ${attempts}...`);

            // Xóa cookies cũ
            await globalPage.deleteCookie();

            // Thêm cookies mới
            for (const cookie of formattedCookies) {
                try {
                    await globalPage.setCookie(cookie);
                } catch (error) {
                    console.warn(`Không thêm được cookie ${cookie.name}:`, error);
                }
            }

            // Refresh trang
            await globalPage.reload({ waitUntil: 'networkidle0' });
            await delay(5000);

            // Kiểm tra trạng thái đăng nhập
            loginSuccess = await checkLoginStatus(globalPage);

            if (!loginSuccess) {
                console.log(`Đăng nhập không thành công lần ${attempts}`);
                if (attempts < 3) {
                    await delay(2000);
                }
            }
        }

        if (!loginSuccess) {
            throw new Error('Đăng nhập thất bại sau 3 lần thử');
        }

        res.json({ success: true, message: 'Đăng nhập thành công' });
    } catch (error) {
        console.error('Lỗi đăng nhập:', error);
        if (globalBrowser) {
            await globalBrowser.close();
            globalBrowser = null;
            globalPage = null;
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// API endpoint để thực hiện report bài viết
app.post('/report', async (req, res) => {
    try {
        let { url } = req.body;
        // Hỗ trợ cả 1 URL hoặc nhiều URL (mỗi dòng 1 URL)
        if (typeof url === 'string') {
            url = url.split('\n').map(u => u.trim()).filter(Boolean);
        }
        if (!Array.isArray(url) || url.length === 0) {
            throw new Error('Vui lòng nhập ít nhất 1 URL bài viết');
        }

        // Kiểm tra đăng nhập
        if (!globalBrowser || !globalPage) {
            throw new Error('Vui lòng đăng nhập trước khi report');
        }
        const isLoggedIn = await checkLoginStatus(globalPage);
        if (!isLoggedIn) {
            throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại');
        }

        let results = [];
        for (let i = 0; i < url.length; i++) {
            const postUrl = url[i];
            try {
                await globalPage.goto(postUrl, { waitUntil: 'networkidle0' });
                // Timeout tổng cho mỗi bài viết (ví dụ 40s)
                const reportResult = await Promise.race([
                    globalPage.evaluate(async () => {
                        function isInsideHidden(el) {
                            return el.closest('[aria-hidden="true"]') !== null;
                        }
                        function randomDelay(min = 1000, max = 2000) {
                            return Math.floor(Math.random() * (max - min + 1)) + min;
                        }
                        async function waitForSelectorText(texts, timeout = 500) {
                            const start = Date.now();
                            while (Date.now() - start < timeout) {
                                for (const text of texts) {
                                    const el = Array.from(document.querySelectorAll('span'))
                                        .find(span => span.innerText.trim() === text && !isInsideHidden(span));
                                    if (el) return el;
                                }
                                await new Promise(r => setTimeout(r, 200));
                            }
                            console.log('❌ Không tìm thấy selector cho các text:', texts);
                            return null;
                        }
                        async function clickByTexts(texts, delay = 2000) {
                            const el = await waitForSelectorText(texts);
                            if (el) {
                                const btn = el.closest('[role="button"], div[tabindex]');
                                if (btn && !isInsideHidden(btn)) {
                                    btn.click();
                                } else {
                                    el.click();
                                }
                                await new Promise(r => setTimeout(r, delay));
                                return true;
                            }
                            // Nếu không tìm thấy, trả về false để bước tiếp theo không bị treo
                            return false;
                        }
                        async function clickStepsInOrder(steps = [], delay = 500) {
                            for (const stepTexts of steps) {
                                let clicked = false;
                                for (let i = 0; i < 1; i++) {
                                    const found = await clickByTexts(stepTexts, delay);
                                    if (found) {
                                        clicked = true;
                                        break;
                                    }
                                    await new Promise(resolve => setTimeout(resolve, delay));
                                }
                                if (!clicked) {
                                    console.log(`❌ Không tìm thấy nút nào trong nhóm: [${stepTexts.join(', ')}]`);
                                } else {
                                    await new Promise(resolve => setTimeout(resolve, delay));
                                }
                            }
                        }
                        async function reportPostSimple(steps) {
                            // Lấy tất cả các nút ba chấm có aria-label đúng
                            let menuBtns = Array.from(document.querySelectorAll('div[aria-label="Actions for this post"][role="button"]'))
                                .filter(btn => btn.offsetParent !== null && !isInsideHidden(btn));

                            // Ưu tiên nút đầu tiên đang hiển thị
                            let menuBtn = menuBtns[0] ||
                                document.querySelector('div[aria-label="More actions"][role="button"]') ||
                                document.querySelector('div[role="button"][tabindex="0"][aria-haspopup="menu"][aria-label="Actions for this post"]') ||
                                document.querySelector('div[aria-label="Hành động với bài viết này"] [role="button"][tabindex="0"]') ||
                                document.querySelector('div[aria-label="More actions for this post"]') ||
                                document.querySelector('div[aria-label="Các hành động khác cho bài viết này"]') ||
                                document.querySelector('div[aria-label="More"]') ||
                                document.querySelector('div[aria-label="Khác"]') ||
                                document.querySelector('div[role="button"][tabindex="0"][aria-haspopup="menu"]') ||
                                document.querySelector('div[role="button"][tabindex="0"]');
                            if (!menuBtn) {
                                console.log('❌ Không tìm thấy nút menu ba chấm của bài viết');
                                return { success: false, error: 'Không tìm thấy nút menu ba chấm của bài viết' };
                            }

                            // Luôn scroll vào vùng nhìn thấy và click lại menuBtn để đảm bảo menu hiện ra
                            menuBtn.scrollIntoView({behavior: 'smooth', block: 'center'});
                            menuBtn.click();
                            await new Promise(resolve => setTimeout(resolve, randomDelay()));

                            // Chờ menu report xuất hiện (ví dụ: nút 'Báo cáo bài viết' hoặc 'Report post')
                            await waitForSelectorText(["Báo cáo bài viết", "Report post"], 2000);

                            await clickStepsInOrder(steps, randomDelay());
                            return { success: true };
                        }
                        const defaultReportSteps = [
                            ["Báo cáo bài viết", "Report post", "Report"],
                            [
                                "Thông tin sai sự thật, lừa đảo hoặc gian lận",
                                "Scam, fraud or false information",
                                "False information",
                                "Fraud or scam",
                                "Scam or fraud or false information"
                            ],
                            ["Gian lận hoặc lừa đảo", "Fraud or scam", "Scam or fraud"],
                            ["Gửi", "Submit"],
                            ["Tiếp", "Next"],
                            ["Xong", "Done"],
                            ["Tôi không muốn thấy điều này", "I don't want to see this"]
                        ];
                        return await reportPostSimple(defaultReportSteps);
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Quá thời gian xử lý bài viết (timeout)')), 40000))
                ]);
                if (reportResult && reportResult.success) {
                    results.push({ url: postUrl, success: true });
                } else {
                    results.push({ url: postUrl, success: false, error: reportResult && reportResult.error ? reportResult.error : 'Không rõ nguyên nhân' });
                }
            } catch (err) {
                results.push({ url: postUrl, success: false, error: err.message });
            }
            // Đợi 5s trước khi chuyển sang bài tiếp theo
            if (i < url.length - 1) await delay(200);
        }
        res.json({ success: true, message: 'Đã hoàn tất quá trình report', results });
    } catch (error) {
        console.error('Lỗi report:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API endpoint để đóng browser
app.post('/close-browser', async (req, res) => {
    try {
        if (globalBrowser) {
            await globalBrowser.close();
            globalBrowser = null;
            globalPage = null;
            res.json({ success: true, message: 'Đã đóng trình duyệt' });
        } else {
            res.json({ success: true, message: 'Trình duyệt đã được đóng' });
        }
    } catch (error) {
        console.error('Lỗi khi đóng trình duyệt:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
}); 