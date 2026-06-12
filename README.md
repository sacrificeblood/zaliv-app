# 🚀 План залива — инструкция по деплою на Railway

## Деплой за 5 минут

### 1. Загрузи код на GitHub
 
```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/ВАШ_НИК/zaliv-app.git
git push -u origin main
```

### 2. Создай проект на Railway

1. Зайди на [railway.app](https://railway.app) и войди через GitHub
2. Нажми **New Project → Deploy from GitHub repo**
3. Выбери репозиторий `zaliv-app`
4. Railway сам определит Node.js и задеплоит

### 3. Добавь PostgreSQL

1. В проекте нажми **+ New → Database → Add PostgreSQL**
2. Railway автоматически добавит переменную `DATABASE_URL` в сервис

### 4. Готово!

Сайт будет доступен по URL вида `https://zaliv-app-production.up.railway.app`

---

## Локальный запуск

```bash
# Создай .env файл
echo "DATABASE_URL=postgresql://user:pass@localhost:5432/zaliv" > .env

# Установи зависимости
npm install

# Запусти
npm start
```

## Структура проекта

```
zaliv-app/
├── server.js        # Express сервер + API
├── public/
│   └── index.html   # Весь фронтенд
├── package.json
├── railway.toml     # Конфиг Railway
└── .gitignore
```
