# Dance of the Devils — Мультиплеер

## Деплой на Render.com

### Шаг 1 — GitHub
Загрузи ВСЁ содержимое этой папки в новый репозиторий:
```
devils-mp/
├── server.js
├── package.json
└── public/
    ├── index.html
    └── textures/   (вся папка с текстурами)
```

### Шаг 2 — Render.com
1. render.com → **New → Web Service**
2. Подключи репозиторий
3. Настройки:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: **Free**
4. Deploy → получи ссылку вида `https://devils-mp.onrender.com`

### Управление в мультиплеере
- **A / D** или стрелки — движение
- **Пробел** / стрелка вверх — прыжок
- **F** — атака (на ПК)
- **⚔ кнопка** — атака (на мобиле)
- **💬 ЧАТ** — открыть/закрыть чат
