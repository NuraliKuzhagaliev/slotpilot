# Архитектура: реализованный этап 0 и будущий переход

## Работает в коде этого этапа

```text
.env.local: постоянный ключ, тестовые пароли
                 │ только сервер
                 ▼
локальный Node HTTP server → AssemblyAI GET /v1/token
                 │ временный токен + inline-конфигурация
                 ▼
браузер → WebSocket AssemblyAI → tool.call
                 │
                 ▼
браузерный адаптер → POST /api/tools → get_services → серверный каталог
                 │
                 ▼
очередь tool.result → WebSocket → ответ и субтитры
```

Браузер не получает постоянный ключ и не рассчитывает цены. Каталог — серверный демонстрационный набор из ТЗ, не PostgreSQL. `probeId` обозначает локальную авторизованную проверку и **не** подменяет будущий `requestId` обращения на запись.

## Локальные маршруты

| Маршрут | Контракт / ограничение |
|---|---|
| GET `/api/status` | Без секретов: наличие конфигурации, часы Asia/Almaty, `bookingEnabled: false` |
| POST `/api/login` | `{username,password}`; только подготовленные client/admin; роль задаёт сервер |
| POST `/api/logout` | Снимает локальную сессию |
| GET `/api/session` | Принадлежность текущей cookie, роль, probeId |
| POST `/api/voice/token` | Авторизация + `{consent:true}` + лимиты; возвращает временный токен, fixed WS URL, inline config |
| POST `/api/tools` | Авторизация + `{callId,name,arguments}`; разрешён только `get_services` |

`get_services.arguments` — пустой объект или `{vehicleId}`. Идентификаторы: `sedan-petrol`, `crossover-petrol`, `ev-demo`. Дополнительные поля отклоняются. Имена аргументов camelCase, имя инструмента snake_case. Повтор callId с теми же аргументами возвращает тот же результат, с другими — ошибку. Из этого нельзя делать вывод о транзакционной защите будущих записей.

## Аудио и инструменты

У ввода и вывода отдельные AudioContext с фактической частотой устройства. Capture переводит поток в 24 kHz PCM16 little-endian и отправляет после `session.ready`; playback воспроизводит через ограниченный кольцевой буфер. При начале речи пользователя и подтверждённом событии interruption очередь старого звука очищается. Это алгоритмически протестировано, но реальное устройство ещё не проверялось.

Результат функции сохраняет исходный call_id и отправляется в idle-окне после completed `reply.done`. Начало новой пользовательской реплики / прерывание инвалидирует старые **read-only** результаты. Частичные пользовательские субтитры заменяются по item_id, а не складываются в дубликаты.

Stop немедленно прекращает захват, отправляет `session.end`, ожидает `session.ended`; если связь не отвечает, закрывает сокет через ограниченный интервал. Автопереподключения нет. Новый Start запрашивает новый временный токен.

## Переход к основному приложению — пока не реализовано

После живой проверки переносить проверенные аудио/transport-модули в Next.js, а не поддерживать два production backend. На первом этапе основного приложения: один `src/contracts/domain.ts`, серверное обращение/владелец/requestVersion/stateRevision, детерминированный подбор, PreparedAction и реальное согласие, PostgreSQL-транзакция создания Booking + двух ResourceReservation, exclusion constraints и чтение результата после перезагрузки.

Схема пробного `get_services` нужна как проверяемый пример, но не разрешает независимо определять сущности в A/B/C. Подробные обязательные правила — в исходном ТЗ, разделах 4–8. В частности, перебивание речи не отменяет уже сохранённую запись; для изменяющих операций нужен actionId и сверка результата.

## Документы, проверенные перед написанием адаптера

По официальным материалам AssemblyAI, просмотренным 23 сентября 2026 года:

- Quickstart: https://www.assemblyai.com/docs/voice-agents/voice-agent-api
- Browser integration и временные токены: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration
- Function tools: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/tools/client-side-tools
- Перебивания: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/turn-detection-and-interruptions
- Языки: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/supported-languages
- JS starter, изученная точка входа: https://github.com/AssemblyAI/voice-agent-starter-js/blob/main/deployment/browser/server.mjs

В документации основной рекомендованный путь — stored agent; inline-конфигурация описана как отдельная альтернатива. Здесь сохранён выбор inline из ТЗ, без agent_id и автоматической публикации. Доступность конкретного аккаунта документация не доказывает. Перед изменением провайдера или переносом адаптера сверить текущую документацию повторно.
