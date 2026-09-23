# Реальная Supabase · 23 сентября 2026

Проект: SlotPilot, ref `lylcxxdrpralrstxzuct`, Lord Org, Free ($0/month), eu-central-1.
Миграция: slotpilot_initial, применена через Supabase MCP.

`npm run test:db` успешно завершился с exit 0:
- Только один из двух конкурентных CAS с одинаковой ревизией сохранился.
- PostgreSQL exclusion вернул 23P01 для пересекающихся интервалов; вся транзакция откатилась, ревизия не изменилась.
- Смежные интервалы [start,end) разрешены.
- Одинаковые ресурсы в разных namespaces изолированы.
- Тестовые резервирования очищены; осталось по пустому test-only документу.

Проверки полномочий: три таблицы с RLS; anon/authenticated SELECT=false; service_role SELECT/INSERT/UPDATE/DELETE=true. Три RPC — invoker, anon EXECUTE=false.

Доктор подтвердил реальное подключение. 12 route-handler/PostgreSQL сценариев прошли отдельно, см. route-integration.log. Рабочий namespace slotpilot-demo тестами не изменялся.

AssemblyAI key не настроен в хостинге; новый живой голос не проверялся. Полный P0 не объявляется принятым.
