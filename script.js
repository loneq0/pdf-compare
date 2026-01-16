// Хранилище схем сборки
let pdfSchemes = [];

// API базовый URL
const API_URL = 'http://localhost:3000/api';

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    loadReference();
    loadPDFList();
    setupEventListeners();
});

// Рендеринг списка PDF файлов
function renderPDFList() {
    const pdfList = document.getElementById('pdf-list');
    
    if (pdfSchemes.length === 0) {
        pdfList.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">Схемы сборки отсутствуют</p>';
        return;
    }
    
    pdfList.innerHTML = pdfSchemes.map(scheme => {
        // Проверяем similarity правильно - может быть null, undefined или число
        const similarity = (scheme.similarity !== null && scheme.similarity !== undefined && typeof scheme.similarity === 'number') 
            ? scheme.similarity 
            : null;
        
        const similarityColor = (similarity !== null && typeof similarity === 'number')
            ? similarity >= 80 ? '#27ae60' 
            : similarity >= 50 ? '#f39c12' 
            : '#e74c3c' 
            : '#95a5a6';
        
        const similarityText = (similarity !== null && typeof similarity === 'number') 
            ? `${similarity}%` 
            : 'N/A';
        
        // Экранируем имя файла для HTML
        const escapedName = scheme.name.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
        const escapedFilename = scheme.filename.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
        
        return `
            <div class="pdf-item" onclick="event.stopPropagation(); openPDF('${escapedFilename}', '${escapedName}')" onmouseover="event.stopPropagation()">
                <span class="pdf-delete" onclick="event.stopPropagation(); deletePDF('${escapedFilename}', '${escapedName}')" title="Удалить файл">×</span>
                <span class="pdf-item-icon">📄</span>
                <div class="pdf-item-title">${scheme.name}</div>
                <div class="pdf-item-info">
                    Размер: ${scheme.size} | Дата: ${scheme.date}
                </div>
                ${similarity !== null ? `
                    <div class="pdf-similarity">
                        <span class="similarity-label">Совпадение с эталоном:</span>
                        <span class="similarity-value" style="color: ${similarityColor}">${similarityText}</span>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Загрузка эталонного файла
async function loadReference() {
    try {
        const response = await fetch(`${API_URL}/reference`);
        if (response.ok) {
            const reference = await response.json();
            renderReference(reference);
        } else {
            document.getElementById('reference-card').innerHTML = 
                '<p style="text-align: center; color: #999; padding: 20px;">Эталонный файл не найден (test-reference.pdf)</p>';
        }
    } catch (error) {
        console.error('Ошибка загрузки эталона:', error);
        document.getElementById('reference-card').innerHTML = 
            '<p style="text-align: center; color: #999; padding: 20px;">Эталонный файл не найден</p>';
    }
}

// Рендеринг эталонной карточки
function renderReference(reference) {
    const referenceCard = document.getElementById('reference-card');
    const escapedName = reference.name.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
    const escapedFilename = reference.filename.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
    
    referenceCard.innerHTML = `
        <div class="pdf-item reference-item" onclick="openPDF('${escapedFilename}', '${escapedName}')">
            <span class="reference-badge">Эталон</span>
            <span class="pdf-item-icon">⭐</span>
            <div class="pdf-item-title">${reference.name}</div>
            <div class="pdf-item-info">
                Размер: ${reference.size} | Дата: ${reference.date}
            </div>
        </div>
    `;
}

// Загрузка списка PDF с сервера
async function loadPDFList() {
    try {
        const response = await fetch(`${API_URL}/pdfs`);
        if (!response.ok) throw new Error('Ошибка загрузки списка');
        
        pdfSchemes = await response.json();
        renderPDFList();
    } catch (error) {
        console.error('Ошибка:', error);
        document.getElementById('pdf-list').innerHTML = 
            '<p style="text-align: center; color: #e74c3c; padding: 40px;">Ошибка подключения к серверу. Убедитесь, что сервер запущен на порту 3000.</p>';
    }
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Загрузка файла
    const uploadInput = document.getElementById('pdf-upload');
    uploadInput.addEventListener('change', handleFileUpload);
    
    // Закрытие модального окна
    const modal = document.getElementById('pdf-modal');
    const closeBtn = document.querySelector('.close');
    
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// Обработка загрузки файла
async function handleFileUpload(event) {
    const file = event.target.files[0];
    
    if (!file) return;
    
    // Проверка типа файла
    if (file.type !== 'application/pdf') {
        alert('Пожалуйста, выберите PDF файл');
        event.target.value = '';
        return;
    }
    
    // Проверка размера (10 МБ)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
        alert('Размер файла не должен превышать 10 МБ');
        event.target.value = '';
        return;
    }
    
    // Создание FormData для отправки файла
    const formData = new FormData();
    formData.append('pdf', file);
    
    try {
        const response = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка загрузки файла');
        }
        
        const result = await response.json();
        console.log('Файл загружен:', result);
        
        // Обновляем список после загрузки
        await loadPDFList();
        
        // Показываем уведомление с процентом совпадения
        const similarity = result.file.similarity;
        let message = 'Файл успешно загружен!';
        if (similarity !== null) {
            message += `\n\nСовпадение с эталоном: ${similarity}%`;
        } else {
            message += '\n\n(Эталонный файл не найден для сравнения)';
        }
        // alert(message);
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        alert('Ошибка при загрузке файла: ' + error.message);
    }
    
    // Сброс input
    event.target.value = '';
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

// Открытие PDF в модальном окне
function openPDF(filename, title) {
    const modal = document.getElementById('pdf-modal');
    const modalTitle = document.getElementById('modal-title');
    const pdfViewer = document.getElementById('pdf-viewer');
    
    modalTitle.textContent = title;
    
    // Получаем PDF файл с сервера
    pdfViewer.src = `${API_URL}/pdfs/${filename}`;
    
    modal.style.display = 'block';
}

// Удаление PDF файла
async function deletePDF(filename, name) {
    // if (!confirm(`Вы уверены, что хотите удалить файл "${name}"?`)) {
    //     return;
    // }
    
    try {
        const response = await fetch(`${API_URL}/pdfs/${filename}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка удаления файла');
        }
        
        // Обновляем список после удаления
        await loadPDFList();
        
        // alert('Файл успешно удален!');
    } catch (error) {
        console.error('Ошибка удаления:', error);
        alert('Ошибка при удалении файла: ' + error.message);
    }
}

// Глобальные функции для onclick (нужны для правильной работы в HTML)
window.openPDF = openPDF;
window.deletePDF = deletePDF;