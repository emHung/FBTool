// Hàm hiển thị thông báo trạng thái
function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('status');
    statusDiv.className = `status-${type}`;
    statusDiv.textContent = message;
}

// Hàm parse cookies từ text
function parseCookies(cookieText) {
    // Xử lý trường hợp cookie là một chuỗi các cặp key-value
    if (cookieText.includes(';')) {
        const cookiePairs = cookieText.split(';');
        return cookiePairs.map(pair => {
            const [name, value] = pair.trim().split('=');
            return {
                name: name.trim(),
                value: value ? value.trim() : '',
                domain: '.facebook.com',
                path: '/'
            };
        }).filter(cookie => cookie.name && cookie.value);
    }
    
    // Xử lý trường hợp cookie là dạng tab-separated
    const lines = cookieText.split('\n');
    const cookies = [];
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.split('\t');
        if (parts.length >= 7) {
            cookies.push({
                name: parts[5],
                value: parts[6],
                domain: '.facebook.com',
                path: '/'
            });
        }
    }
    
    return cookies;
}

// Hàm xử lý đăng nhập
async function handleLogin() {
    try {
        const cookiesText = document.getElementById('cookies').value;
        if (!cookiesText) {
            showStatus('Vui lòng nhập cookies', 'error');
            return;
        }

        showStatus('Đang xử lý đăng nhập...', 'info');

        // Parse cookies từ text
        const cookies = parseCookies(cookiesText);
        if (cookies.length === 0) {
            showStatus('Không tìm thấy cookies hợp lệ. Vui lòng kiểm tra lại định dạng.', 'error');
            return;
        }

        console.log('Parsed cookies:', cookies); // Debug log

        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cookies })
        });

        const data = await response.json();
        
        if (data.success) {
            showStatus('Đăng nhập thành công!', 'success');
            // Chuyển sang tab report sau khi đăng nhập thành công
            document.getElementById('report-tab').click();
        } else {
            showStatus(data.message || 'Đăng nhập thất bại', 'error');
        }
    } catch (error) {
        showStatus('Có lỗi xảy ra: ' + error.message, 'error');
    }
}

// Hàm xử lý report bài viết
function handleReport() {
    const postUrls = document.getElementById('postUrls').value;
    if (!postUrls.trim()) {
        showStatus('Vui lòng nhập ít nhất 1 URL bài viết!', false);
        return;
    }
    showStatus('Đã bắt đầu quá trình report!', 'info');
    fetch('/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: postUrls })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            // Hiển thị kết quả từng bài viết
            let html = '<b>Đã hoàn tất quá trình report!</b><br><ul>';
            data.results.forEach((item, idx) => {
                if (item.success) {
                    html += `<li style='color:green'>✅ Bài ${idx+1}: Thành công - <a href='${item.url}' target='_blank'>Xem bài</a></li>`;
                } else {
                    html += `<li style='color:red'>❌ Bài ${idx+1}: Thất bại - <a href='${item.url}' target='_blank'>Xem bài</a> (${item.error || 'Lỗi không xác định'})</li>`;
                }
            });
            html += '</ul>';
            document.getElementById('status').className = 'status-info';
            document.getElementById('status').innerHTML = html;
        } else {
            showStatus('Có lỗi xảy ra: ' + data.message, false);
        }
    })
    .catch(err => {
        showStatus('Có lỗi xảy ra: ' + err.message, false);
    });
} 