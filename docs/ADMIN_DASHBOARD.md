# Главная страница Admin (B4)

`/admin/` — Dashboard; существующий компонент категорий переиспользуется на
`/admin/categories`. Товары, заказы, детали заказа и Telegram сохраняют маршруты.
Из главной страницы доступны только ссылки и GET-запросы, без business mutations.

## Периоды

`GET /admin/dashboard?range=today|7d|30d|custom` защищён существующими Admin
session/Worker origin/HMAC guards. Для GET CSRF не нужен. Public origin и
анонимные запросы не получают данные. Ответ не кешируется.

По умолчанию 7 дней: сегодня и 6 предыдущих календарных дней. 30 дней аналогично.
Custom: `from=YYYY-MM-DD&to=YYYY-MM-DD`, обе даты включительно, максимум 366 дней.
Неверные даты, обратный диапазон, неизвестные параметры и даты для preset — 400.
Сервер вычисляет границы: начало включительно, полночь после последнего дня
исключительно. Сегодня охватывает весь business day. Бизнес-время Asia/Tashkent,
UTC+05:00 без сезонного перевода в период работы магазина; время браузера не
участвует ни в вычислении периода, ни в отображении дат заказов.

## Семантика

- Заказы и полученные оплаты зависят от выбранного периода.
- Полученные оплаты: сумма `Payment.expectedAmount` только для APPROVED.
  Дата — `reviewedAt`, при историческом NULL — `submittedAt`. Каждая запись
  учитывается один раз; предоплата и финальная оплата (включая cargo) складываются.
  `Order.paidAmount` в KPI/графике не используется. Это подтверждённые поступления,
  без расчёта прибыли или затрат.
- Ждут проверки: текущие PREPAYMENT_SUBMITTED и FINAL_PAYMENT_SUBMITTED за всё время.
- В работе: AWAITING_PURCHASE, PURCHASED, IN_TRANSIT, ARRIVED, WEIGHING,
  AWAITING_FINAL_PAYMENT, FINAL_PAYMENT_SUBMITTED, PAID_FULL, READY_TO_SHIP, SHIPPED.
  Не входят AWAITING_PREPAYMENT, PREPAYMENT_SUBMITTED, COMPLETED, CANCELLED.
- Активные товары: текущий `Product.status=ACTIVE`, независимо от периода.
- Заканчиваются: текущие активные варианты с finite stock 0–3.
  `LOW_STOCK_THRESHOLD=3` в D1 repository. В сводке отдельно 1–3 и 0;
  `stock=null` (безлимитный/preorder) и неактивные варианты не учитываются.
  Учитываются активные варианты независимо от статуса родительского товара.
- Последние заказы: 8 за всё время, `createdAt DESC,id DESC`. Клиент: fullName,
  затем Telegram username, имя/фамилия, numeric ID. DTO содержит только publicId,
  customer, total, paid, status, createdAt; paid включает paidAmount+cargoPaidAmount.
  Телефон, адрес, proof keys/URLs и credentials не возвращаются.

## Реализация и проверки

Шесть SELECT-запросов: дневные заказы, дневные оплаты, текущие состояния заказов,
статусы товаров, остатки и LIMIT 8 последних заказов с одним JOIN User. SQL
агрегирует данные; все заказы/платежи не выгружаются в память. Пропущенные дни
заполняются нулями на сервере. Схема и миграции не меняются.

SVG-график без новой зависимости: заказы/оплаты, сетка, точки, адаптивная ширина,
полное значение в UZS, выбор дня мышью, касанием или стрелками/Home/End.
Подтверждённый touch-выбор сохраняется после отрыва пальца. На мобильном последние
заказы отображаются карточками. Используются существующие переводы order statuses,
настройки RU/UZ и светлая/тёмная темы. Loading показывает skeleton без вымышленных
чисел, ошибка оставляет shell с повторной загрузкой.

Focused tests: disposable D1, локальный workerd, UI/routing fixtures.
Визуальная проверка — отдельный localhost fixture server без live DB/секретов.
После deploy разрешены только read-only проверки; live orders/payments/products,
stock и Telegram не изменяются.
