const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;

// Путь к тестовому эталонному файлу
const TEST_PDF_PATH = path.join(__dirname, 'uploads', 'test-reference.pdf');

// Создаем папку для PDF файлов, если её нет
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Настройка CORS
app.use(cors());
app.use(express.json());

// Функция для правильного декодирования имени файла с кириллицей
function decodeFileName(filename) {
    try {
        // Если имя файла закодировано неправильно (latin1 вместо utf8)
        const buffer = Buffer.from(filename, 'latin1');
        const decoded = buffer.toString('utf8');
        // Проверяем что декодирование дало результат с кириллицей
        if (/[а-яё]/i.test(decoded)) {
            return decoded;
        }
    } catch (e) {
        // Если не получилось, пробуем другой способ
    }
    
    try {
        // Альтернативный способ - через decodeURIComponent
        return decodeURIComponent(escape(filename));
    } catch (e) {
        // Если ничего не помогло, возвращаем как есть
        return filename;
    }
}

// Раздача статических файлов (HTML, CSS, JS)
app.use(express.static(__dirname));

// Настройка Multer для загрузки PDF
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Сохраняем оригинальное имя файла
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 МБ
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Только PDF файлы разрешены!'));
        }
    },
    preservePath: false
});

// Функция форматирования размера файла
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

// Функция сравнения двух PDF файлов
async function comparePDFs(file1Path, file2Path) {
    try {
        // Читаем оба PDF файла
        const dataBuffer1 = fs.readFileSync(file1Path);
        const dataBuffer2 = fs.readFileSync(file2Path);
        
        // Парсим текст из PDF
        const pdf1 = await pdfParse(dataBuffer1);
        const pdf2 = await pdfParse(dataBuffer2);
        
        const text1 = pdf1.text.trim().toLowerCase();
        const text2 = pdf2.text.trim().toLowerCase();
        
        // Если оба пустые (возможно, это сканированные изображения)
        if (!text1 && !text2) {
            // Сравниваем размер файлов как альтернативу
            const size1 = dataBuffer1.length;
            const size2 = dataBuffer2.length;
            const sizeDiff = Math.abs(size1 - size2);
            const avgSize = (size1 + size2) / 2;
            return Math.round(Math.max(0, 100 - (sizeDiff / avgSize) * 100));
        }
        
        if (!text1 || !text2) {
            return 0; // Если один пустой, а другой нет - 0% совпадения
        }
        
        // Простое сравнение по словам (можно улучшить алгоритмом Левенштейна)
        const words1 = text1.split(/\s+/).filter(w => w.length > 0);
        const words2 = text2.split(/\s+/).filter(w => w.length > 0);
        
        const set1 = new Set(words1);
        const set2 = new Set(words2);
        
        // Подсчет совпадающих слов
        let matches = 0;
        for (const word of set1) {
            if (set2.has(word)) {
                matches++;
            }
        }
        
        // Процент совпадения на основе уникальных слов
        const totalUniqueWords = new Set([...words1, ...words2]).size;
        const similarity = totalUniqueWords > 0 ? (matches / totalUniqueWords) * 100 : 0;
        
        // Дополнительная проверка по длине текста
        const lengthSimilarity = Math.min(text1.length, text2.length) / Math.max(text1.length, text2.length) * 100;
        
        // Среднее значение двух метрик
        return Math.round((similarity * 0.7 + lengthSimilarity * 0.3));
    } catch (error) {
        console.error('Ошибка при сравнении PDF:', error);
        return 0;
    }
}

// Получить эталонный файл
app.get('/api/reference', (req, res) => {
    try {
        if (!fs.existsSync(TEST_PDF_PATH)) {
            return res.status(404).json({ error: 'Эталонный файл не найден' });
        }

        const stats = fs.statSync(TEST_PDF_PATH);
        const fileName = path.basename(TEST_PDF_PATH);
        
        const referenceInfo = {
            id: 'reference',
            name: 'test-reference',
            filename: fileName,
            size: formatFileSize(stats.size),
            date: stats.birthtime.toISOString().split('T')[0]
        };

        res.json(referenceInfo);
    } catch (error) {
        console.error('Ошибка при получении эталона:', error);
        res.status(500).json({ error: 'Ошибка при получении эталонного файла' });
    }
});

// Получить список всех PDF файлов
app.get('/api/pdfs', async (req, res) => {
    try {
        const files = fs.readdirSync(uploadsDir);
        
        // Фильтруем тестовый файл из списка
        const pdfFiles = files.filter(file => 
            file.endsWith('.pdf') && file !== 'test-reference.pdf'
        );
        
        const pdfList = await Promise.all(pdfFiles.map(async (file) => {
            const filePath = path.join(uploadsDir, file);
            const stats = fs.statSync(filePath);
            
            // Сравнение с тестовым файлом, если он существует
            let similarity = null;
            if (fs.existsSync(TEST_PDF_PATH)) {
                try {
                    similarity = await comparePDFs(filePath, TEST_PDF_PATH);
                    // Убеждаемся что similarity это число
                    if (typeof similarity !== 'number' || isNaN(similarity)) {
                        similarity = 0;
                    }
                } catch (error) {
                    console.error(`Ошибка сравнения для ${file}:`, error);
                    similarity = 0;
                }
            }
            
            // Декодируем имя файла для правильного отображения кириллицы
            let displayName = decodeFileName(file.replace(/^\d+-/, '')).replace(/\.pdf$/, '');
            
            return {
                id: file.replace(/\.pdf$/, ''),
                name: displayName,
                filename: file,
                size: formatFileSize(stats.size),
                date: stats.birthtime.toISOString().split('T')[0],
                similarity: similarity !== null && similarity !== undefined ? similarity : null
            };
        }));
        
        // Сортировка по дате
        pdfList.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        res.json(pdfList);
    } catch (error) {
        console.error('Ошибка при получении списка файлов:', error);
        res.status(500).json({ error: 'Ошибка при получении списка файлов' });
    }
});

// Загрузить новый PDF файл
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не был загружен' });
        }

        const filePath = req.file.path;
        let similarity = null;

        // Сравнение с тестовым файлом, если он существует
        if (fs.existsSync(TEST_PDF_PATH)) {
            try {
                similarity = await comparePDFs(filePath, TEST_PDF_PATH);
                // Убеждаемся что similarity это число
                if (typeof similarity !== 'number' || isNaN(similarity)) {
                    similarity = 0;
                }
            } catch (error) {
                console.error('Ошибка сравнения при загрузке:', error);
                similarity = 0;
            }
        }

            // Декодируем оригинальное имя файла для правильного отображения кириллицы
        let displayName = decodeFileName(req.file.originalname).replace(/\.pdf$/, '');

        const fileInfo = {
            id: req.file.filename.replace(/\.pdf$/, ''),
            name: displayName,
            filename: req.file.filename,
            size: formatFileSize(req.file.size),
            date: new Date().toISOString().split('T')[0],
            similarity: similarity !== null && similarity !== undefined ? similarity : null
        };

        res.json({
            message: 'Файл успешно загружен',
            file: fileInfo
        });
    } catch (error) {
        console.error('Ошибка при загрузке файла:', error);
        res.status(500).json({ error: error.message || 'Ошибка при загрузке файла' });
    }
});

// Получить PDF файл для просмотра
app.get('/api/pdfs/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(uploadsDir, filename);

        // Проверка безопасности - только файлы из папки uploads
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Файл не найден' });
        }

        // Проверка что это PDF
        if (!filename.endsWith('.pdf')) {
            return res.status(400).json({ error: 'Неверный формат файла' });
        }

        res.sendFile(filePath);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка при получении файла' });
    }
});

// Удалить PDF файл
app.delete('/api/pdfs/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(uploadsDir, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Файл не найден' });
        }

        fs.unlinkSync(filePath);
        res.json({ message: 'Файл успешно удален' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка при удалении файла' });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📁 PDF файлы сохраняются в: ${uploadsDir}`);
});
