# Контракты 1a и ограничения их готовности

Канонический источник — `src/contracts/domain.ts`. TypeScript-типы выводятся из runtime-схем. JSON Schema получается из тех же определений, не переписывается вручную в frontend или voice. Экспорт: `npm run contracts:export`.

Этап 2 расширяет первоначальные контракты: `app.ts` содержит runtime/JSON-схемы Booking, Action, Evidence, Operation, Callback, SessionRecord, AppState, Snapshot и ErrorResponse; все TypeScript-типы выводятся из них. `tool-outputs.ts` задаёт и проверяет результат каждого из десяти инструментов. При сохранении и чтении PostgreSQL проверяется всё состояние. Общая HTTP-обёртка инструмента — `{ok:true,data:<тип результата>,...Snapshot}`, ошибка — ErrorResponse. Серверная HMAC-cookie подтверждает владельца; постоянные пользовательские аккаунты не реализуются.

## Условия

`serviceIds`, `vehicleId`, `allowedDates`, `arrivalNotBefore`, `readyNoLaterThan`, `maxBudgetKzt`, `allowedBranchIds`, `preferredBranchId`, `rankingPreference`.

Неизвестные nullable-поля — `null`. Пропущенное поле patch означает сохранение текущего значения, явный `null` снимает конкретное ограничение. `serviceIds: []` очищает услуги. Для добавления/удаления предусмотрены `addServiceIds`/`removeServiceIds` внутри patch. Их нельзя смешивать с полной заменой `serviceIds` или одновременно добавлять и удалять одну услугу. Правила такого изменения проверяет бизнес-функция `patchConstraints`, а структурный JSON Schema проверяет форму и допустимые значения.

Наборы услуг/дат/филиалов нормализуются сортировкой. Нормализованный no-op не увеличивает версии. Изменение условий увеличивает requestVersion и stateRevision и сбрасывает старые options/PreparedAction.

Максимум три услуги. Для подбора нужны услуги, автомобиль и хотя бы одна дата. Отсутствующий бюджет и временные предпочтения не выдумываются. `allowedBranchIds: null` означает, что жёсткий фильтр филиала не задан; пустой массив запрещён. Предпочитаемый филиал при заданном allow-list должен входить в него.

## Локальные функции

| Функция | Вход | Выход |
|---|---|---|
| `updateRequest` | state, доверенный Actor, patch, expectedVersion | новый BookingRequest или ошибка; без записи в БД |
| `findOptions` | BookingRequest, Dataset, `{ now, nextOptionId }` | SearchResult; чистый алгоритм, не публичный endpoint |
| `searchOwnedRequest` | request, Actor, expectedVersion, Dataset, context | SearchResult после локальной проверки владельца и версии |
| `acceptSearchResult` | актуальный state, SearchResult | `{ applied, state }`; поздний результат отклоняется |
| `comparePreviousOption` | прошлый SlotOption, новые условия, Dataset, now | новая длительность/цена/готовность и причины несоответствия |

Каждый SlotOption привязан к requestId, requestVersion, calendarRevision, ресурсам и expiresAt. Предложение не удерживает слот. `stillFits` в сравнении означает только соответствие пересчитанным условиям; это не разрешение подтвердить старую версию предложения.

## Инструменты

В `tools.ts` определены входы всех десяти инструментов из ТЗ. Они пока **contract-only** для основного приложения. В probe реально работает только старый изолированный `get_services`; новые схемы не добавлены автоматически в prompt или session configuration.

`requestId`, владелец и роль не принимаются от модели. Их должен получать адаптер из авторизованного серверного контекста. `confirmed: true` запрещён схемой `confirm_booking`; вместо него есть `confirmationRef`, но проверка, что такая ссылка действительно связана с завершённой репликой/кликом и нужным actionId, ещё не реализована.

`get_booking` принимает ровно один селектор: bookingId либо actionId. `prepare_change` имеет разные строгие схемы отмены и переноса. Runtime и JSON Schema описывают одни и те же варианты union.

Перед подключением этих схем к Voice Agent проверить совместимость JSON Schema-представления с актуальной документацией и живым аккаунтом. Экспорт не заявляется уже проверенной AssemblyAI-конфигурацией.

## Следующий рубеж

Нужны выходные envelopes с машинными кодами, серверная сессия, сохранение состояния, PreparedAction/ConfirmationEvidence, транзакция PostgreSQL и конкурентные проверки. Нельзя считать совпадение схем доказательством атомарности или фактического согласия клиента.

Новые JSON Schema экспортируются в `docs/stage2/app-schemas.json` и `docs/stage2/tool-output-schemas.json`. `npm run typecheck` сначала обновляет Next route types, поскольку Next и Sites генерируют их в общей `.next` директории.
