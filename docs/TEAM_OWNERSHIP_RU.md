# Границы трёх участников после 1a

Участник B — интегратор. Пока нет выбранного удалённого репозитория и полного Next.js-каркаса: не выдавать этот пакет за готовую базу для независимой установки разных зависимостей тремя людьми.

| Участник | Разрешённая зона |
|---|---|
| A — UI | `src/features/booking-ui/`, `src/features/admin-ui/`, `src/components/ui/`; страницы согласовать с B при создании Next.js |
| B — интеграция | `src/contracts/`, голосовой транспорт, защищённые voice/tools маршруты, agents, root config, package/lockfile, layout, CI, инструкции |
| C — domain/DB | `src/server/domain/`, `src/server/db/`, SQL migrations/seed в `supabase/`, request/admin/demo backend; тесты domain/БД |

`src/contracts/` уже содержит базу моделей подбора. Не создавать вторую версию CustomerConstraints или SlotOption. B завершает контракты сохранённых операций и общие output/errors перед интеграцией. C сохраняет публичные интерфейсы чистого ядра или согласует их изменение с B. A не импортирует server/db fixture как готовую производственную базу и не объявляет успех записи по локальному состоянию.

Probe остаётся изолированным диагностическим модулем, не вторым backend основного продукта. Только B меняет его транспорт. В 1a модификации его исходников не делались.

Новые зависимости, framework lockfile и точные пути страниц фиксирует B один раз после доступной установки/сборки. Затем — отдельные ветки/PR, без работы втроём в main и без force-push в общую ветку. У каждого отдельное тестовое окружение/namespace и собственные серверные секреты.

Тесты 1a используют Node test runner для работы без установки зависимостей. После подключения согласованных Vitest/Playwright перенести тот же набор сценариев, не удалять проверки ради зелёного результата.

## Основной проект после этапа 2

A: src/features/booking-ui/, app/page.tsx, app/admin/, app/demo/, app/globals.css.
B: src/features/voice/, public/audio/, agents/booking.ts, app/api/voice/, app/api/tools/, app/api/evidence/, app/api/session/, src/server/app/auth.ts, общий контракт/конфиги/CI.
C: src/server/domain/, src/server/app/{state,db,operations}.ts, supabase/, request/admin/demo endpoints, DB integration tests.
Новая структура отражена в ARCHITECTURE_RU.md. Старые описания выше относятся к архиву 1a. Предыдущие tests и spikes сохранены.
