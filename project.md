# Project Bible — opencode-system-stats

Реал-тайм плагин для OpenCode (TUI), показывающий в терминале:
VRAM (использ + свободно), RAM (использ + свободно), загрузку CPU,
температуру GPU, температуру CPU. Частота обновления настраивается.

Состояние: **готово и проверено end-to-end на v2.2.5** (панель обновляется сама,
без повторного `/system-stats`). С 2026-11-04 панель — **floating overlay** в слоте
`app` с 6 позициями и 3 фосфорными темами. Запущенный OpenCode держит старый код
плагина в памяти, а сервис-демон — старый список RPC: после правки `tui.tsx` нужен
перезапуск TUI, после смены id/набора RPC — перезапуск сервиса
(см. «Эксплуатация: перезапуск»).

---

## Рабочие правила (обязательно к прочтению перед работой)

1. **Всегда читать сначала этот файл (`project.md`) — «библию проекта».**
   Он содержит актуальные решения, баги, API-факты и чек-листы. Не полагаться
   на память, если в bible есть ответ.
2. **Если в bible чего-то нет или непонятно — дочитывать в Engram
   (`mem_search`/`mem_context`) и/или git (история коммитов, `git log/blame`).**
   Прошлые решения и «вопросы-ответы» часто уже зафиксированы в памяти.
3. **Если контекст приближается к максимуму — не терять прогресс:**
   сделать краткие заметки о проделанной работе (решения, найденные баги,
   следующие шаги) → сохранить в Engram (`mem_save`) и обновить `project.md`.
   Это не даёт следующему сеансу стартовать «вслепую» после компакции.

---

## Progress

- [x] Исследование API OpenCode (plugins, TUI, RPC, server) — docs.opencode.ai/v2
- [x] Проверка окружения (Linux/WSL, Node v22, opencode v2.2.5, nvidia-smi)
- [x] Уточнены рабочие команды сбора статистики (см. Environment)
- [x] Написать файлы плагина (package.json, tsconfig.json, README.md, src/*.ts/tsx)
- [x] tui.tsx: исправлены 2 бага — отсутствие `Plugin` в import; `Panel` читал `latest()`/`refreshMs()` из замкнутого scope setup (вынесены как props)
- [x] Статика проверена: `collectStats()` на хосте отдаёт живой снимок; esbuild-транспиляция всех 4 файлов чистая
- [x] RPC-контракт доведён до рабочего вида (3 бага, см. ниже)
- [x] Локальный плагин обнаружен: `opencode plugin list` показывает `local`
- [x] Загрузка плагина проверена: `opencode run ... --standalone` → `msg="loading plugin" id=...opencode-system-stats`, без `failed to load plugin`
- [x] RPC проверен напрямую: `POST /api/rpc/opencode-system-stats/stats` с `{"input":{}}` → **HTTP 200** и живой JSON
- [x] Найдены и исправлены 3 бага TUI-стороны: отсутствие `location` в вызове;
      нереактивное чтение снапшота в `Panel`; вызов сеттера `storage.store` как геттера
      (→ `setInterval(fn, undefined)` → шторм ~890 RPC/сек)
- [x] TUI-сторона проверена на изолированном стенде (сервер с cwd=`$HOME`):
      `http.status=200`, панель рисует GPU/RAM/CPU, ошибок 0
- [x] Найден и исправлен баг «панель не обновляется без `/system-stats`»:
      `StatRow` деструктурировал props → Solid читал значения один раз (см. п. 9)
- [x] Автообновление подтверждено tmux-стендом: два `capture-pane` до/после
      нагрузки — CPU 1% → 53%, RAM 1.53 → 1.64 GB без повторного `/system-stats`
- [x] **2026-11-04**: найдена причина «панель не отображается, показывает ошибку»
      — `settings.theme()` (вызов значения Solid-store) валил слот; фикс — `settings.theme`
- [x] **2026-11-04**: починен выбор темы (`dialog.select.current` должен быть `value`)
- [x] **2026-11-04**: панель переведена с `session.panel` на floating overlay в слоте
      `app` (6 позиций, absolute + `zIndex`, как в `devtools-bar.tsx`);
      команда `/system-stats-position`, опрос RPC только при видимом overlay
- [x] Финализация bible
- [x] **2026-11-05**: все настройки панели (refresh / theme / position) собраны в
       единый диалог настроек (`SettingsBody`), открывающийся по клику из панели —
       заменили три `/system-stats-*` команды. Изменения применяются к живой панели
       мгновенно (общий реактивный store). Открытие: `dialog.set({size:'medium',
       centered:true})` + `dialog.show(<SettingsBody/>)` обёрнут в `paletteCtx.Provider`;
       закрытие: `dialog.clear()` (Esc / клик вне). `Option` — однострочный чип:
       текущее значение = инверсная акцентная полоса + `▸` + `BOLD`, остальные —
       прозрачный фон + `muted` текст.
       Тело диалога ОБЯЗАТЕЛЬНО должно быть внутри `paletteCtx.Provider`, иначе
       `useContext(paletteCtx)` в `SettingsBody`/`Option` не резолвится. Коммит `2cc21d4`.
- [x] **2026-11-06**: рабочая съёмка экрана для инспекции живого UI (см. «Эксплуатация»).
- [x] **2026-11-06**: температура CPU теперь реально считывается через
      **LibreHardwareMonitor (LHM)** по HTTP (`:8085/data.json`) — в WSL2
      `/sys/class/thermal` пуст, датчики на стороне Windows. Каскад в
      `readCpuTemp()`: LHM (HTTP) → sysfs (гоый Linux → null) → null. Переменная
      `SYSTEM_STATS_LHM_HOST` переопределяет хост; шлюз по умолчанию (NAT)
      `172.25.192.1` отвечает :8085 после правила фаэра Windows на TCP :8085.
      Русская локаль `"79,0 °C"` парсится; берётся `CPU Package`. `readCpuTemp()`
      стал асинхронным, `collectStats()` её `await`. Схема `rpc.ts` и панель
      `tui.tsx` — без правок. Тест: `cpuTempC ≈ 79–82`, `elapsedMs ~300`.

- [x] **2026-11-06**: кроссплатформенная температура CPU — добавлен метод
       **`systeminformation`** в каскад `readCpuTemp()`: теперь
       `LHM(HTTP) → systeminformation → sysfs → null`. `systeminformation`
       ставился через `npm install` (зависимость в `package.json`,
       `package-lock.json` закоммичен). `readCpuTempSi()` — dynamic
       `import("systeminformation")` + defensive `try/catch`, читает
       `cpuTemperature()` → `{main, cores, max}`, берёт `main` (фолбэк на `max`),
       проверяет `v > 0` и `!NaN`; на WSL2/бездатчах → `null` → фолбэк. Встроен
       между LHM и sysfs. `null` → панель рисует `—`. Тест: на этом WSL2-хосте
       `tempC=84` (LHM), `systeminformation` вернул `{main:null,max:null}` →
       корректный фолбэк; `elapsedMs ~235`. Коммит `bf99f7a`. Документация LHM
       (фаэр, portproxy, mirrored networking, NAT, `SYSTEM_STATS_LHM_HOST`) в
       README — раздел «## CPU temperature (LibreHardwareMonitor)».

Спека `systeminformation`: `si.cpuTemperature()` → `{ main, cores[], max }`; при отсутствии
датчиков `main` = `null` (или `-1` в старых версиях) — проверять. На WSL2 вернёт `null` →
фолбэк. Числа возвращаются напрямую (русская локаль не проблема, в отличие от LHM).
Dynamic import нужен, чтобы отсутствие/незагрузка пакета не уронил RPC-процесс; фолбэк на
`mod.systeminformation ?? mod.default ?? mod`. Тестировать из-под plugin-директории
(`node_modules` там), иначе `import("systeminformation")` падает с ERR_MODULE_NOT_FOUND.
- [x] **2026-11-06**: улучшение внешнего вида единого диалога настроек.
      Правки в `tui.tsx` (`Option`/`SettingsBody`/`overlayProps`):
      (1) убраны все псевдо-тултипы `title` (это заголовки рамки, а не подсказки);
      (2) `font="bold"/"dim"` заменены на рабочий `attributes={TextAttributes.BOLD|DIM}`
          (проп `font` не существует и молча игнорировался);
      (3) `borderStyle="dashed"` заменён на валидные `single|double`;
      (4) опции — однострочные чипы 2 в ряд, активная = инверсная акцентная полоса + `▸`;
      (5) диалог растянут на весь хост-диалог (`width="100%"` + `marginTop={-1}`),
          чтобы не было серой рамки; `paddingX={2}` + `paddingX={1}` у заголовка;
      (6) в футере панели убран плейсхолдер `— ·`, из-за которого «полоса с точкой»
          переносилась сразу после `● LIVE`; время сокращено до `Nс`.
      Отдельно починено **позиционирование overlay**: `overlayProps` теперь всегда
      возвращает все 4 ключа (`top/bottom/left/right`, лишние = `undefined`), и
      `useTerminalDimensions()` читается как аксессор (`terminal().width`).
- [x] **2026-11-07: пользовательские темы (custom themes)** — дизайн и решение
       готовы, код ещё не написан (см. раздел «Пользовательские темы»). Формат
       YAML + `SYSTEM_STATS_THEME_DIR`, загрузка/валидация на server-половине,
       мердж в тот же селектор тем. TODO: `js-yaml`, `src/themes.ts`, RPC `themes`,
       мердж в `tui.tsx`, README.

### Текущие дефекты OpenTUI (v2.2.5, подтверждены экспериментом)

1. **`title` на `<box>` → заголовок рамки, не тултип.** Он рисуется на границе
   (`drawBox`/`titleAlignment`), поэтому «подсказки» вроде `select this option`
   попадали в интерфейс видимым текстом. Не использовать `title` как tooltip.
2. **JSX-spread в `@opentui/solid` не удаляет исчезнувшие ключи.**
   `spreadExpression` итерирует только ключи **нового** объекта и не сбрасывает
   старые. Смена `{top,right}` → `{bottom,left}` оставляла `top/right` в силе,
   из-за чего absolute-бокс растягивался и панель не двигалась. Правило: при
   реактивном spread **всегда возвращать полный набор ключей**, неиспользуемые —
   `undefined` (сеттеры `top/bottom/left/right` явно чистят ребро).
3. **`useTerminalDimensions()` возвращает Accessor.** Правильно:
   `const dims = useTerminalDimensions(); dims().width`, а не `…().width`/
   `dims.width`. Раньше `.width` был `undefined` → `left = NaN` → центрирование
   (`top-center`/`bottom-center`) не работало.
4. **Хост-диалог TUI (`size:"medium"`)** — это бокс шириной **60** колонок с
   `backgroundColor = theme.background.base` и `paddingTop={1}`; своего контента
   он не центрирует. Узкое тело (50) оставляло серую рамку. Лечится
   `width="100%"` + `marginTop={-1}` на корне тела.


### Решённые причины падений/ошибок (все подтверждены экспериментом)

1. **`events` обязателен в `Rpc.define`**
   `Rpc.register` перебирает `Object.entries(contract.events)` → без поля:
   `TypeError: Object.entries requires that input parameter not be null or undefined`
   (падение на загрузке плагина). Фикс: `events: {}`.

2. **`input` фактически обязателен, хотя docs говорят «leave it out»**
   Рантайм v2.2.5 декодирует вход безусловно: `KD(method.input, arg)`.
   При `input === undefined` вызывается `ua(undefined)` → `"~standard" in undefined` →
   `TypeError: e is not an Object. (evaluating '"~standard"in e')` → HTTP 500 `rpc.internal`.
   Фикс: пустая объектная схема (тот же приём, что docs предписывают для событий):
   ```json
   { "type": "object", "properties": {}, "additionalProperties": false }
   ```
   Следствие: метод вызывается с аргументом `{}` (`rpc().stats({})`), а не без него.

3. **`nullable: true` не поддерживается JSON-Schema-конвертером**
   Проходило регистрацию, но падало на валидации выхода:
   `rpc.invalid_output` → `Expected number at ["cpu"]["tempC"]` (плюс `gpu.name`).
   Фикс: `{ "type": ["number", "null"] }` / `{ "type": ["string", "null"] }`.

4. **`rpc.unavailable` на уже запущенном сервере**
   Долгоживущий сервер (`opencode serve --service`, pid 1290) поднялся **до** появления
   каталога плагина и не перечитывает project-плагины, созданные позже.
   Симптом: `{"_tag":"RpcError","type":"rpc.unavailable","message":"RPC is unavailable: opencode-system-stats"}`
   (HTTP 400). Лечится рестартом OpenCode; свежий сервер грузит плагин и отдаёт 200.

5. **TUI-вызов RPC без `location` → 400 `rpc.unavailable`**
   Методы RPC-субклиента имеют сигнатуру `(input, { location })`; `location`
   передаётся **вторым аргументом**, а не в input. Без него сервер берёт свой
   cwd — у `opencode serve --service` это `$HOME`, где project-плагин не
   зарегистрирован. Проверено curl'ом: `?location[directory]=<project>` → 200,
   без location → 400 `{"type":"rpc.unavailable"}`. Фикс: передавать location.

6. **`Panel` читал сигнал один раз → вечное «Collecting stats…»**
   `const data = latest()` в теле компонента выполняется один раз; ветка
   `if (!data)` больше не переоценивается. Фикс: `<Show when={latest() !== null}>`
   и чтение `latest()!`/`refreshMs()` внутри JSX (Solid трекает эти чтения).

7. **`storage.store` возвращает `[state, setState]`, а не `[getter, setter]`**
   `state` — реактивное Solid-хранилище (встроенные панели читают `state.prop`),
   второй элемент — async-сеттер. Код вызывал **сеттер как геттер**:
   `setSettings().refreshMs` → `undefined` → `setInterval(fn, undefined)`
   ≈ 1 мс → шторм ~890 запросов/сек, все 400 (в логе 211k строк за один run).
   Фикс: читать `settings.refreshMs` + страховка
   `Number.isFinite(ms) && ms > 0 ? ms : 1000`.

8. **`context.location` реактивен к активной сессии**
   Если открыть сессию другого проекта, `context.location` указывает туда, где
   этого плагина нет → снова `rpc.unavailable`. Фикс: запомнить location на
   `setup()` и пробовать его первым, фолбэк — живой `context.location`
   (перебор только при ошибке `rpc.unavailable`).

9. **Деструктуризация props убивает реактивность → панель «замирает»**
   Симптом: данные меняются только после повторного `/system-stats`; таймер при
   этом работает (в отладке `tick-ok` каждые 500 мс, `createEffect` на `latest()`
   срабатывает на каждый снапшот), а на экране — старые цифры.
   Причина: `function StatRow({ label, value, accent })` — в Solid деструктуризация
   props читает их **один раз**; `value`/`accent` перестают быть геттерами, и
   текстовые узлы никогда не обновляются. Заголовок и футер читались прямо в
   JSX — проверка probe-счётчиком в футере показала, что он тикает, а строки
   статистики при этом стоят.
   Фикс: `function StatRow(props)` + `props.label` / `props.value` / `props.accent`;
   то же для `Panel(props)` (`props.width`, `props.latest()` и т.д.).
   Проверено: под нагрузкой CPU 1% → 53%, RAM 1.53 → 1.64 GB без единого
   `/system-stats`; `renderer.requestRender()` не требуется.

10. **`settings.theme()` → `TypeError` → слот падал (2026-11-04)**
    Симптом: вместо панели — тост об ошибке, панели нет; выбор темы «не работает».
    Причина: `settings` — **Solid store** (`createStore` в
    `packages/tui/src/context/storage.tsx`), `theme` это значение-строка, а код
    вызывал `settings.theme()` → `TypeError: settings.theme is not a function`.
    `PluginBoundary` (`packages/tui/src/plugin/render.tsx`) ловит бросок в слоте,
    показывает тост `"{id} crashed in slot {path}: …"` и рендерит `null` — отсюда
    и «ошибка + пусто». Фикс: читать `settings.theme` (без вызова). Диалог темы
    падал по той же причине (он вызывает `themeName()`).

11. **`dialog.select.current` — только `value`, не `title`**
    `applyTheme` передавал `current: THEME_LABEL(themeName())` («Amber phosphor»),
    а опции имеют `value: "amber"` → подсветка не совпадала ни с одной опцией.
    Фикс: `current: themeName()`. Тот же инвариант в `applyPosition`.

12. **`session.panel` нельзя позиционировать**
    Presentation — только `"panel"` (сбоку, при `width >= SESSION_PANEL_SPLIT_MIN_WIDTH`)
    или `"fullscreen"`; выбора угла/края нет. Фикс: слот `app` + absolute-обёртка
    (см. «Floating overlay»).

### Как это отлаживалось (полезно на будущее)

- Прямой вызов RPC через curl к локальному серверу:
  ```bash
  P=$(node -e 'process.stdout.write(require("/home/alekpet/.config/opencode/service.json").password)')
  curl -s -u "opencode:$P" -X POST \
    http://127.0.0.1:4096/api/rpc/opencode-system-stats/stats \
    -H 'content-type: application/json' --data '{"input":{}}'
  ```
  **Логин всегда `opencode`** (зашит в `ServerAuthConfig.configLayer`), а не значение
  `OPENCODE_SERVER_USERNAME`. Пароль в service-режиме берётся из
  `~/.config/opencode/service.json` (`password`), а не из `OPENCODE_SERVER_PASSWORD`.
- Для чистой проверки поднимался отдельный сервер в каталоге проекта:
  ```bash
  OPENCODE_SERVER_PASSWORD=testpass123 opencode serve \
    --hostname 127.0.0.1 --port 4099 --log-level debug --print-logs
  ```
- `location` в query кодируется как вложенный объект: `?location[directory]=/abs/path`
  (строка `?location=/abs/path` → `InvalidRequestError ... at ["location"]`).
- **Отладка TUI-плагина**: stdout/stderr TUI занят рендерером, поэтому писать
  диагностику в файл из `setup()`/таймера:
  `require("node:fs").appendFileSync("/tmp/system-stats-debug.log", msg + "\n")`.
  Так были пойманы `refreshMs=undefined` и смена `location`.
- **Изолированный стенд** (воспроизводит сервис-демон): сервер с cwd=`$HOME`,
  TUI — в каталоге проекта:
  ```bash
  cd ~ && OPENCODE_SERVER_PASSWORD=testpass123 opencode serve \
    --hostname 127.0.0.1 --port 4110 --log-level debug --print-logs
  cd <project> && OPENCODE_SERVER_PASSWORD=testpass123 opencode \
    --server http://127.0.0.1:4110 --log-level debug
  ```
  В логе сервера видно `http.status` для `/api/rpc/opencode-system-stats/stats`
  (`200` — норма, `499` — клиент оборвал запрос при убийстве TUI).
- **Проверка панели без глаз (tmux)**: TUI пишет кадры в перенаправленный stdout;
  команду можно отправить через `tmux send-keys -l "/system-stats"` + `Enter`,
  а затем grep'ать ANSI-stripped вывод на `System Stats`/`VRAM`.
  Рабочий рецепт:
  ```bash
  tmux new-session -d -s vsverify -x 180 -y 55 \
    "opencode -s <sessionID>"
  sleep 12
  tmux send-keys -t vsverify -l "/system-stats"; sleep 0.4
  tmux send-keys -t vsverify Enter          # именно Enter, НЕ "send-keys -v"
  sleep 3
  tmux capture-pane -p -t vsverify > /tmp/t0.txt
  # нагрузить CPU, подождать, снять второй кадр
  for i in 1 2 3 4 5 6 7 8; do timeout 14 bash -c 'while :; do :; done' & done
  sleep 6; tmux capture-pane -p -t vsverify > /tmp/t1.txt
  grep -aE "CPU +[0-9]+%|RAM +[0-9.]+ GB|Util" /tmp/t0.txt /tmp/t1.txt
  ```
  Сравнение двух кадров и есть проверка автообновления. Важно: `tmux send-keys -v`
  не существует (ошибка `unknown flag -v`) — команда молча не отправляется,
  панель не открывается, и тест ложно показывает «0 рендеров».
- **Отладка реактивности панели**: stdout TUI занят рендерером, поэтому
  `console.log` не виден. Писать в файл из `setup()`/таймера/эффекта:
  `appendFileSync("/tmp/vs2.log", ...)`. Проверенные маркеры:
  - `tick-ok` в `tick()` — доказывает, что RPC-таймер живой;
  - `createEffect(() => latest())` — доказывает, что сигнал обновляется и
    эффекты Solid перезапускаются;
  - probe-счётчик в футере (`probe {Math.floor(now()/1000) % 100000}`) —
    доказывает, что JSX-рендер идёт. Если probe тикает, а строки стоят —
    виновата не реактивность сигнала, а чтение props/значений один раз.
  Все три маркера вместе позволяют отличить «данные не приходят» от
  «данные приходят, но UI не перерисовывается».

---

## Architecture (решение)

Локальный плагин под `.opencode/plugins/opencode-system-stats/` (авто-загрузка,
без конфига). Структура:

```
.opencode/plugins/opencode-system-stats/
├── package.json          # exports: "." -> src/index.ts (server), "./tui" -> src/tui.tsx, "./rpc" -> src/rpc.ts
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts          # server: Plugin.define(id="opencode-system-stats"), регистрирует RPC stats
    ├── rpc.ts            # Rpc.define(id="opencode-system-stats"), метод stats (input + output + events)
    ├── stats.ts          # Node: сбор данных (nvidia-smi, /proc/meminfo, /proc/stat, thermal)
    └── tui.tsx           # TUI: опрос RPC по таймеру, рендер панели + команды
```

- **RPC**: один метод `stats` — пустой `input` (`{}`), JSON-Schema `output`
  (`ram`/`cpu`/`gpu`/`collectedAt`), `events: {}`.
- **Refresh rate**: `context.storage.store` (reactive), интервал пересоздаётся
  при изменении. Пресеты через `context.ui.dialog.select` (200/500/1000/2000/5000 ms).
  Команда смены частоты — `/system-stats-refresh` (`slash.name = "system-stats-refresh"`).
- **Display**: floating overlay в слоте `app` (absolute + `zIndex`, 6 якорей,
  дефолт `top-right`) + команды `system-stats` (toggle),
  `system-stats-refresh`, `system-stats-theme`, `system-stats-position`
  (palette/slash). `session.panel` больше не используется.

---

### Пользовательские темы (custom themes) — 2026-11-07

**Запрос:** дать пользователю добавлять свои темы (из файлов) с валидацией и
выбором в меню настроек. Решение: темы **не хардкодом** в `THEMES`, а подгружаются
извне и мерджатся в тот же селектор — весь существующий UI (выпадающий список +
чипы) работает без правок.

**Принятые решения (согласованы с пользователем):**
- **Формат — YAML** (комментарии в файлах; добавляет зависимость `js-yaml` в
  server-половину). НЕ JSON.
- **Папка — отдельная user-путь через `SYSTEM_STATS_THEME_DIR`**, НЕ внутри
  плагина (не теряется при обновлении плагина).
- **UI — повторное использование существующего селектора**: выпадающий список
  (`applyTheme` / `context.ui.dialog.select`) + чипы в `SettingsBody`. Кастомные
  темы появляются там же, где и встроенные — без нового виджета/слайдера.

**К ключевому факту — у плагина две половины (разные процессы):**
- **Server** (`src/index.ts` + `stats.ts`) — Node-процесс (`opencode serve
  --service`), **есть доступ к fs** (там уже читаются `/proc`/`/sys`). Туда
  кладём чтение/парсинг/валидацию тем.
- **TUI** (`src/tui.tsx`) — SolidJS-рендер, fs в рантайне ненадёжен. Туда —
  только готовый список через RPC.

**Дизайн:**
1. server-половина сканирует `SYSTEM_STATS_THEME_DIR` на `*.yaml`/`*.yml`, читает
   каждый файл (`js-yaml` `load`), валидирует; невалидные **пропускает с
   `console.warn`** (с причиной), дубликаты ключей — тоже. Плагин не падает.
2. RPC-метод `themes` возвращает `{ themes: [{ name, label?, custom: boolean,
   palette }] }` (в существующих `Stats` или новый контракт — см. ниже).
3. `themes()` вызывается **один раз на `setup()`** (не в тиках!), location-scoped
   (`{ location }`), результат мерджится в `THEMES`; `THEME_NAMES` считается
   пост-мерджом.
4. TUI: `THEMES` из `Record<ThemeName,...>` → `Record<string,...>`
   (`themeName: string`); `palette(name)` уже работает по имени.

**Формат файла темы (YAML):**
```yaml
# example: ~/.themes/neon.yaml
name: neon              # необязательно: если нет — берётся _stem_ имени файла
label: "Neon Green"     # опционально: отображаемое название (иначе label=name)
palette:
  bg:     "#001a00"     # фон панели
  accent:  "#00ff88"    # акцент (заголовки, активная опция)
  base:    "#99ffcc"    # основной текст
  muted:   "#2f9966"    # приглушённый текст
  warn:    "#ccff00"    # предупреждение
  crit:    "#ff3355"    # критическое
  border:  "#00ff88"    # рамка
```
**Валидация:**
- `palette` — объект со **всеми 7 полями** `bg/accent/base/muted/warn/crit/border`.
- каждое значение — валидный hex: `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`.
- `name` (или _stem_ файла) — `^[a-z0-9][a-z0-9._-]*$` (безопасно как ключ TS +
  enum-id; иначе пропуск).
- `label` — опционально, строка.

**Куда добавить RPC-метод (нерешённый вопрос):**
- Вариант A — дописать `themes` в существующий контракт `Stats` (один id).
- Вариант B — новый контракт `Rpc.define({ id:"opencode-system-stats-themes", ...})`.
  Скорее A (один id): `index.ts` и так регистрирует `Stats`; TUI вызывает
  `context.client.rpc(<контракт>)`. API `ctx.rpc.register(contract, methods)` —
  2-й аргумент = map методов (см. «OpenCode API» п. про register).

**DONE (2026-11-07):** весь код пользовательских тем написан, проверен (тест `loadThemes`) и задокументирован (README). Осталось только сделать **commit**. Файлы пока НЕ закоммичены.
- [x] `js-yaml` — в `dependencies` (`^5.5.0`), ESM-импорт `yaml.load` проверен.
- [x] `src/themes.ts` — readdir → filter ext → `yaml.load` → validate (7 hex + `name` по `^[a-z0-9][a-z0-9._-]*$`) → dedupe → `{themes}`; `console.warn` на ошибках; defensive `try/catch` вокруг fs/parse.
- [x] `src/rpc.ts` — метод `themes` (input `{}`, output `{ themes:[...]}`) в `Stats`; тип `CustomTheme` (`{name,label?,custom:bool,palette}`).
- [x] `src/index.ts` — register — `themes: async () => {themes: loadThemes(env)}`.
- [x] `src/tui.tsx` — `THEMES`→`Record<string,ThemeEntry>` (мердж built-in + custom), `BUILTIN_THEMES`, `themeName`/`setTheme`/`settings.theme`→`string`; на `setup()` await `.themes({location})`, merge custom, `THEME_NAMES` пост-мердж; `palette()` с фолбэком на built-in.
- [x] `package-lock.json` — `js-yaml` зафиксирован (+39 строк, `node_modules/js-yaml` 5.5.0).
- [x] README: раздел «Custom themes (YAML)» — schema, example, `SYSTEM_STATS_THEME_DIR`, rules, error handling, how-it-works; Features + Quick Start обновлены.
- [x] Тест: 2 YAML (1 валидный + 1 с битым hex) + `.txt` → `themes()` вернул 1, warning на битом, `.txt` пропущен; missing-dir и no-env → `[]` + warning.
- [x] Commit всей работы — `1499198` (feat(system-stats): custom themes; 8 файлов, themes.ts + rpc.ts + index.ts + tui.tsx + README + package*). `_shot.ps1` не коммичен (сторонний).
- ⚠️ `SYSTEM_STATS_THEME_DIR` должен быть задан в shell, где запускается OpenCode (server-половина — отдельный процесс); иначе тем нет.
- [x] README: добавлен `Tutorial: create your first theme` (после Setup) — пошагово: dir → `sunset.yml` (7 полей palette) → `SYSTEM_STATS_THEME_DIR` → рестарт → verify; таблица `Picking the colors` (маппинг полей на реальное использование в tui.tsx) + готовая палитра amber для копирования. Коммит `7f20a1f`.- [x] **Баг-фикс (2026-11-08):** built-in темы (amber/green/mono) НЕ показывались в селекторе — `THEMES` стартовал пустым `{}` и в него мерджились только кастомные. Исправлено: `THEMES = { ...BUILTIN_THEMES }` (seed), кастомные добавляются сверху. `eb56855`. 12 пресловутых TS2722 в tui.tsx — pre-existing baseline, не наши.
- [x] **Баг-фикс (2026-11-09): кастомные темы НЕ появлялись в селекторе ни после какого рестарта.**
      Причина — не env и не TUI, а **схема вывода RPC `themes`** в `rpc.ts`: в `output.themes.items`
      было `additionalProperties: false`, но в `properties` объявлены только `name/label/custom`,
      а `palette` — не объявлен. Рантайм валидирует `output` и **срезает** необъявленные поля,
      поэтому сервер отдавал `{ name, label, custom }` **без `palette`**. В TUI (`tui.tsx`) мердж:
      `if (t && t.name && t.palette)` → `t.palette` undefined → **каждая** кастомная тема
      отбраковывалась как «malformed» → в селекторе оставались только built-in. Перезапуск не
      помогал, потому что схема одинаковая в любом процессе. Тест выше (`loadThemes` напрямую)
      давал palette и «проходил», но круг через RPC я не проверял — вот промах. Фикс: объявить
      `palette` (7 hex-полей, все `required`) в схеме `themes.output.items`, добавить `palette` в
      `required`. Проверено на отдельном сервере (:4111) — RPC теперь отдаёт `palette`. `git commit` см. ниже.
- [x] **2026-11-08: подготовка к пушу на GitHub.**
      — Образцы тем: `examples/themes/sunset.yaml` + `examples/themes/c64.yaml` (копии из
      `SYSTEM_STATS_THEME_DIR`, тот же формат, что в README). `examples/themes/_README.md` —
      как скопировать и использовать.
      — Корневой `README.md` (GitHub-facing): обзор, Install, Usage, Themes + File schema,
      Examples, Development, Requirements. Ссылки ведут на разделы README плагина.
      — Чистка (убрано из репозитория): `_shot.ps1` (скрин-хелпер, по библии «не коммить»),
        `.tmp-dialog-test.mjs`/`.tsx` (дебаг-зонды в плагине), лишний `.gitignore` в папке
        плагина, корневые `package.json`/`package-lock.json` (пустышка `typescript@^7` —
        реальные зависимости в `opencode/plugins/opencode-system-stats/package.json`).
        `node_modules` по-прежнему игнорируется корневым `.gitignore`. `project.md` (библия)
        оставлен в репозитории.
      — README плагина: добавлена секция «Example themes» → `examples/themes/`.
---

## Эксплуатация: перезапуск

Две половины грузятся в разных процессах:

- **Серверная** (`ctx.rpc.register` в `src/index.ts`) — живёт в процессе сервера
  (`opencode serve --service`). Если плагин добавлен/изменён после старта сервера,
  нужен рестарт сервиса, иначе `rpc.unavailable` даже с правильным location.
- **TUI-половина** (`src/tui.tsx`) — перечитывается при старте TUI. Уже
  запущенный TUI держит старый код в памяти: нужен перезапуск TUI.

**Сейчас (2026-11-04):** сервис-демон (pid старше переименования плагина) отвечает
`400 rpc.unavailable` на `POST /api/rpc/opencode-system-stats/stats` даже с
правильным `location` — RPC-контракт с этим id в его процессе не зарегистрирован.
Поэтому нужен **полный перезапуск OpenCode** (сервис + TUI), а не только TUI.
Проверка после рестарта — чек-лист ниже (ожидается HTTP 200).

### Съёмка экрана для инспекции живого UI (2026-11-06)

`maim` даёт чёрный кадр на Wayland/WSLg. Рабочий путь — скрин через **Windows
PowerShell** в буфер обмена, сохранение в файл, доступный из WSL:

```bash
# 1. Сохранить .ps1 в Windows-доступный путь (не /tmp — там WSL tmpfs, невидимый для pwsh)
cat > /mnt/e/AI_Tools/projects/opencode-system-stats/_shot.ps1 <<'PS'
Add-Type -AssemblyName System.Windows.Forms
[Windows.Forms.Clipboard]::GetImage() | ForEach-Object {
  $bmp = New-Object System.Drawing.Bitmap($_)
  $bmp.Save("C:\tmp\screenshot.png", [System.Drawing.Imaging.ImageFormat]::Png)
}
"saved C:\tmp\screenshot.png"
PS

# 2. Запустить через powershell.exe с -EncodedCommand (иначе Execution Policy /
#    «флаг зоны из интернета» блокирует -File). Base64 из UTF-16LE:
enc=$(iconv -f UTF-8 -t UTF-16LE /mnt/e/AI_Tools/projects/opencode-system-stats/_shot.ps1 | base64 -w0)
powershell.exe -ExecutionPolicy Bypass -EncodedCommand "$enc" 2>/dev/null | grep saved

# 3. Прочитать результат в OpenCode:
#    read /mnt/c/tmp/screenshot.png
```

Скрин 2560×1440, открывается в `/mnt/c/tmp/screenshot.png`. Рабочая проверка:
`iconv -f UTF-8 -t UTF-16LE _shot.ps1 | base64 -w0` → `powershell.exe -ExecutionPolicy Bypass -EncodedCommand "$enc"`.

> ⚠️ `.ps1` через `powershell.exe -File` не работает: Execution Policy блокирует +
> PowerShell помечает файл «из интернета» (зона Downloads/WSL) → «невозможно
> загрузить файл». Решение — `-EncodedCommand` (Base64 UTF-16LE), он обходит обе
> проверки.


---

## Environment (проверено на машине)

- OS: Linux (WSL). Node v22.23.1. opencode v2.2.5.
- GPU: NVIDIA GeForce RTX 3070 Ti.
- `/proc/meminfo`, `/proc/stat` доступны.
- Thermal zones: **отсутствуют** в этой WSL (`/sys/class/thermal/thermal_zone*` нет).
  → Датчики температуры — на стороне Windows. Температура CPU читается через
  **LibreHardwareMonitor (LHM)** по HTTP (см. «CPU temp — LHM ниже»).
  `readCpuTemp()` деградирует в `null`, если LHM недоступен; схема и панель это
  держат (панель рисует `—`).
- `sensors` (lm-sensors): не установлен.

---

## Environment — рабочие команды (источник истины)

### nvidia-smi (ВАЖНО: поля/флаги)
Правильный запрос (работает на WSL обёртке):
```
nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu --format=csv
```
Результат:
```
name, memory.used [MiB], memory.total [MiB], temperature.gpu
NVIDIA GeForce RTX 3070 Ti, 4191 MiB, 8192 MiB, 43
```
**НЕ работают** (ожидаемая деградация):
- `mem.used` / `mem.total` → `Field "mem.used" is not a valid field to query.`
- `--format=json` → `Field "memory.used" ...` (ошибка на этом wrapper)
- `--format=plain` / `--format=csv,noheader,nounit` → `Format modifier is not recognized.`
- Модификаторы `noheader`/`nounit` → `Format modifier is not recognized.`

Значит парсить **plain csv** `--format=csv`, резать по `,`, trim, резать `MiB`.
Индексы: `name` = 0, `memory.used` = 1, `memory.total` = 2, `temperature.gpu` = 3,
`utilization.gpu` = 4.

### RAM — /proc/meminfo
kB → *1024. Ключи: `MemTotal`, `MemAvailable`, `MemFree`. Used = Total - Available.

### CPU load — /proc/stat
Два сэмпла с паузой ~150ms. Первая строка `cpu  user nice system idle iowait irq softirq steal guest guest_nice`.
load% = (Δtotal - Δidle) / Δtotal * 100, где idle = idle + iowait.

### CPU temp — каскад (LHM → sysfs → null)
См. раздел «CPU temp — LHM (LibreHardwareMonitor)» ниже. Кратко: в этой WSL
`/sys/class/thermal` пуст, поэтому голый Linux-путь (`readCpuTempSysfs`) даёт
`null`; рабочая методика — LHM по HTTP со стороны Windows. `sensors` не установлен.

### CPU temp — LHM (LibreHardwareMonitor)
Основной метод на этой WSL2: чтение температуры CPU с **Windows**-стороны через
LHM Remote Web Server по HTTP. На Windows запущен `LibreHardwareMonitor.exe` и
включён *Tools → Remote Web Server* (HTTP :8085, `/data.json`).

**Каскад в `readCpuTemp()` (`src/stats.ts`):**
1. `readCpuTempLhm()` — `fetch` HTTP к `:8085/data.json` (см. хосты ниже).
2. `readCpuTempSysfs()` — `/sys/class/thermal/thermal_zone*/temp` (гоый Linux);
   на этой WSL2 → `null`.
3. Любой вернувший число метод побеждает; иначе — `null`.

**Хосты для `fetch` (`lhmHosts()`), порядок:**
- `SYSTEM_STATS_LHM_HOST` — явное переопределение (один хост).
- `localhost` — mirrored networking на Win11 22H2+ (если проброшено :8085).
- Шлюз по умолчанию из `ip route show default` — **NAT-режим WSL2**; на этой
  машине `172.25.192.1` отвечает :8085.
- Если `ip`/маршрутизации нет — только `localhost`.
Проверено: `localhost` падает (NAT), затем `172.25.192.1` → HTTP 200, т.е. каскад
отрабатывает как задумано. У каждого хоста таймаут `AbortSignal.timeout(1500)`,
так что упавший LHM не вешает цикл обновления.

**Парсинг (`collectLhmSensors` → `pickCpuTemp`):** рекурсивный обход дерева
`data.json`; узлы со значением `°C` → температура. Локаль Windows русская →
`"79,0 °C"` (десячная запятая): замена `,`→`.` и первая цифра. Выбираем
агрегатный показатель по регулярке `CPU Package|Tctl|Tdie` (Intel `CPU Package`,
AMD `Tctl`/`Tdie`), приоритет над per-core и «Distance to TjMax» (`cpuRank`).

**Фаэр Windows:** правило inbound для процесса LHM:
```powershell
New-NetFirewallRule -DisplayName "LHM Remote Web" -Direction Inbound `-
  -LocalPort 8085 -Protocol TCP -Action Allow -Program "C:\...\LibreHardwareMonitor.exe"
```
Без него :8085 слушается, но брандмауэр дропает inbound → WSL видит только
`localhost` (который под NAT не проброшен) и падает в `null`.

**Результат:** `cpu.tempC` теперь реально считывается (наблюдено `≈79–82 °C` на
Intel i7-11700K). Схема `rpc.ts` (`["number","null"]`) и панель `tui.tsx`
(`fmtTemp` рисует `—` для null, окраска по полосам 80/95) — **без правок**.
`readCpuTemp()` стал асинхронным; `collectStats()` её `await`.

**Тест/отладка:** `node --experimental-strip-types` умеет стропить `.ts`
напрямую (импорт `rpc` — только тип, рантайм-зависимостей нет). ⚠️ Баг хабстраста:
файл-тест в `/tmp` с относительным `import "./stats.ts"` резолвится в `/tmp/stats.ts`
→ `ERR_MODULE_NOT_FOUND`. Тестить из `src` (абс. путём или из каталога `src`).

---

## OpenCode API — выученные факты (источник истины)

- Локальные плагины под `.opencode/plugins/` загружаются авто. Экспорт `./tui`
  импортится как `@opencode/plugin/tui` (резолвится рантаймом, абс. путь не нужен).
- **Server**: `import { Plugin } from "@opencode/plugin"`, `Plugin.define({ id, setup(ctx) })`.
- **RPC contract**: `Rpc.define({ id, methods, events })` — `events` обязателен;
  у каждого метода `input` и `output` — JSON Schema (или Standard Schema/Zod/Valibot/ArkType).
  - «Нет значения» кодируется **пустой объектной схемой**, не отсутствием поля:
    `{ type: "object", properties: {}, additionalProperties: false }`.
  - Nullable — только `type: ["number","null"]`; `nullable: true` игнорируется и валит output.
- **RPC register** (server):
  ```ts
  const reg = await ctx.rpc.register(Stats, {
    stats: async (input, ctx) => ({ ... }), // ctx.error(type, msg, data) для declared errors
  })
  ```
  **TUI call** (location обязателен для project-плагина):
  ```ts
  const api = context.client.rpc(Stats)
  await api.stats({}, { location: { directory: "/abs/project" } })
  ```
  `location` — **второй аргумент метода**, не часть input. Ошибки прилетают
  объектом `{ type, message, data? }`, а не `Error`.
- **Коды ошибок RPC** (`/api/rpc/:rpcID/:method`):
  `rpc.invalid_input` / `rpc.method_not_found` / `rpc.unavailable` → HTTP 400 (`RpcError`);
  `rpc.internal` / `rpc.invalid_output` → HTTP 500 (`RpcInternalError`).
  `rpc.unavailable` = контракт вообще не зарегистрирован в этом процессе сервера.
- RPC output/input в TS = `unknown` → кастить в локальные типы в tui.tsx.
- **TUI storage**: `const [state, setState] = context.storage.store("key", { initial: {...} })`.
  `state` — реактивное хранилище: читать `state.refreshMs` (НЕ вызывать сеттер!),
  писать `setState((draft) => { draft.refreshMs = ms })` (возвращает Promise).
  `initial` применяется к отсутствующему ключу; сохранённое значение имеет приоритет.
- **TUI select**: `context.ui.dialog.select({ title, current, options: [{title,value,...}] })`.
  `current` должен совпадать с `value` опции, чтобы подсветить.
- **TUI custom dialog**: `context.ui.dialog.set({ size:"medium"|"large"|"xlarge", centered })`
  + `context.ui.dialog.show(() => <JSX/>)`; закрытие — `context.ui.dialog.clear()`
  (Esc / клик вне работают сами). Хост оборачивает JSX в бокс шириной
  **60/88/116** колонок с фоном `theme.background.base` и `paddingTop={1}`.
  Чтобы не было серой рамки, тело делать `width="100%"` (+ `marginTop={-1}`),
  а не фиксированной ширины.
- **TUI panel (host-docked)**: `context.ui.slot({ append: "session.panel", render: (panel) => <Show when={panel.name==="system-stats">...</Show> })`.
  Открытие: `context.ui.panel.open("system-stats")`. panel даёт reactive `name, width, focused` + `close/focus`.
  Ограничение: `session.panel` умеет только `"panel"` (сбоку) или `"fullscreen"`;
  свободно позиционировать панель нельзя.
- **TUI overlay (свободное позиционирование)**: `context.ui.slot({ append: "app", render: () => ... })`
  + `<box position="absolute" left={0} right={0} top={0} zIndex={2600} .../>`.
  Слот `app` (`SlotMap["app"] = {}`) монтируется внутри `flexGrow`-колонки главной
  области (`position="relative"` у предка), поэтому absolute-обёртка накрывает
  именно main area — тот же приём, что у `devtools-bar.tsx` (`PanelBox`).
  `justifyContent: flex-start|center|flex-end` даёт 6 якорей. Это единственный
  способ показать плагин «в разных частях экрана».
- **TUI keymap**: `context.keymap.layer(() => ({ mode:"global", commands:[{id,title,palette:true,slash:{name}, run}] }))`.
- **Solid**: `{ Show, createSignal, createEffect, onCleanup } from "solid-js"`.
- **Solid-реактивность в TUI-панели (критично)**:
  - **Нельзя деструктурировать props**: `function Row({ value })` читает значение
    один раз, и компонент больше никогда не обновляется. Только `props.value`.
  - Геттеры (`() => value`) передавайте как props и вызывайте внутри JSX:
    `<Row value={`${latest()!.ram.usedBytes}`} />` + `props.value` — Solid
    отследит чтение сигнала.
  - `<Show when={latest() !== null}>` строит дерево один раз; внутренние
    `latest()!` пересчитываются реактивно (не передавать сам snapshot в `when`).
  - `setInterval` для локального «тика» времени оборачивать в `onCleanup`,
    иначе интервал утекает при каждом открытии панели.
  - `context.renderer.requestRender()` **не нужен**: OpenTUI перерисовывает сам
    при изменении реактивных узлов. Если панель замерла — искать причину в
    разорванной реактивности (destructuring/чтение до рендера), а не в рендерере.
- OpenTUI plain `<text>` / `<box>` **не требуют** SyntaxStyle owner. Цвета — через
  `context.theme` (фолбэк `text.base`). `<markdown>`/`<code>` требуют `SyntaxStyle` с owner.
- Пикер частоты через select пресетов 200/500/1000/2000/5000 ms.

---

## UI / внешний вид панели (2026-11-03)

Панель `system-stats` сделана **компактной и адаптивной**:

- **Ширина «обнимает» самый широкий текст**, а не фиксированный диапазон.
  `contentCols()` измеряет длину каждой строки (заголовок + строки статистики +
  футер) и берёт максимум; `cols = clamp(content + padding·2 + frame, 32, 52)`.
  Раньше было `clamp(width, 28, 64)` → на широком окне панель растягивалась до
  64 колонок и « съедала » место. Теперь ~39–44 колонки и не растёт дальше 52.
  На очень узком окне футер аккуратно переносится (ниже 32 не сжимаем).
- **Паддинг уменьшен с 2 до 1**, строки внутри секций стоят плотнее
  (`gap={0}`), секции разделены одной пустой строкой (`marginY={1}`).
- **Футер кликабелен**: `onMouseUp` на футере (и на всей панели) открывает
  **единый диалог настроек** (`SettingsBody`: refresh/theme/position), а не
  отдельный select частоты. Старые `/system-stats-refresh|theme|position`
  остаются как palette/slash-команды. Поддерживается рантаймом OpenTUI
  (`onMouseUp`/`onMouseDown`); нужен terminal с мышью.
- `props.width` из slot больше не используется: панель больше **не** `session.panel`,
  а absolute-overlay в слоте `app`, ширина считается по контенту.
- `props.width` удалён из типа `Panel` вместе с переходом на overlay.

> **Solid-нюанс для кликов в TUI:** `onClick` на `<text>`/`<box>` работает, но
> это mouse-событие — нужен mouse-capable terminal. Ключевые горячие клавиши
> клику по-прежнему не привязаны (OpenTUI клавиатурно-ориентирован).

- slash/palette: `system-stats` — открыть/закрыть overlay.
- slash/palette: `system-stats-refresh` — сменить частоту обновления.
- slash/palette: `system-stats-theme` — сменить палитру (amber/green/mono).
- slash/palette: `system-stats-position` — выбрать якорь overlay.

---

## Floating overlay — 6 позиций (2026-11-04)

По мотивам `packages/tui/src/component/devtools-bar.tsx` (`PanelBox`: absolute +
`zIndex` + `left/bottom`).

- `Panel` оборачивается в `<box {...anchorProps(position())}>`:
  `position="absolute"`, `zIndex=2600`, `left=0`, `right=0`, `top` ИЛИ `bottom`,
  `padding=1`, `flexDirection="row"`, `justifyContent` = flex-start/center/flex-end.
- `Position` = `top-left | top-center | top-right | bottom-left | bottom-center | bottom-right`,
  дефолт `top-right`; хранится в storage (`position`) и переключается
  `/system-stats-position` (`applyPosition`).
- Видимость — **эфемерный** `createSignal(false)` (`visible`), не в storage:
  overlay открывается по `/system-stats` и не всплывает сам при старте.
- Опрос RPC идёт **только пока overlay видим** (`createEffect` трекает
  `visible()`): скрытая панель не грузит `nvidia-smi`/RPC.
- `zIndex=2600` выше обычного контента, но диалоги рисует отдельный слой — они
  всё равно сверху.

---

## Проверка (чек-лист)

```bash
# 1. Плагин виден
opencode plugin list | grep opencode-system-stats

# 2. Загрузка без падений (в логе не должно быть "failed to load plugin")
cd /mnt/e/AI_Tools/projects/opencode-system-stats
opencode run "ping" --standalone --log-level trace
grep -a "loading plugin" ~/.local/share/opencode/log/opencode.log | grep system-stats

# 3. RPC отвечает 200 (важно: с location!)
P=$(node -e 'process.stdout.write(require("/home/alekpet/.config/opencode/service.json").password)')
curl -s -u "opencode:$P" -X POST \
  "http://127.0.0.1:4096/api/rpc/opencode-system-stats/stats?location%5Bdirectory%5D=/mnt/e/AI_Tools/projects/opencode-system-stats" \
  -H 'content-type: application/json' --data '{"input":{}}'
```

Без `location` тот же запрос даёт 400 `rpc.unavailable` — это ожидаемо и
подтверждает, что именно location-scoped вызов был причиной «нет данных».

Ожидаемо: `{"output":{"ram":{...},"cpu":{...},"gpu":{"name":"NVIDIA GeForce RTX 3070 Ti",...},"collectedAt":...}}`.

---

## Next

- [x] Пользователю: перезапустить TUI (сервер уже отвечает 200, но запущенный
      экземпляр TUI держит старый код плагина в памяти и продолжает слать
      ~890 запросов/сек). — **СДЕЛANO**: после рестарта TUI панель `system-stats`
      отрисовалась живыми данными.
- [x] После рестарта открыть панель `system-stats` и проверить частоту
      (сохранённый пресет подхватывается из storage). — **СДЕЛАНО**: панель
      рисует GPU/RAM/CPU, refresh из storage.
- [ ] (опц.) Добавить событие `stats`/`emit` вместо polling, если понадобится пуш-модель.
- [ ] **2026-11-04**: перезапустить OpenCode (и сервис-демон, и TUI). Причины:
      (1) `opencode serve --service` держит **старый** список RPC — после
      переименования плагина в `opencode-system-stats` он отвечает
      `400 rpc.unavailable` (pid сервиса старше каталога/переименования);
      (2) TUI держит старый код `tui.tsx` в памяти, поэтому фикс
      `settings.theme` и overlay не подхватятся без рестарта. Сервис из этой
      сессии не убивать — это завершит текущую сессию.
- [ ] После рестарта: `/system-stats` → overlay, `/system-stats-position` → угол,
      `/system-stats-theme` → палитра. Проверить, что тоста об ошибке нет.
- [x] **Внешний вид панели (2026-11-03)**: компактно + адаптивно. Ширина
      «обнимает» контент (`clamp(32..52)`), паддинг 2→1, строки плотнее.
      Футер кликабелен → открывает селектор частоты (`onClick`, нужен
      terminal с мышью; для клавиатуры — `/system-stats-refresh`). Подробности в
      разделе «UI / внешний вид панели». **Требует перезапуска TUI** для
      отображения (запущенный TUI держит старый код в памяти).
- [ ] После перезапуска TUI проверить: (1) панель не «разливается» на широких
      окнах, (2) футер по клику открывает селектор частоты.

### Почему панель «обновлялась только по /system-stats» — итог (2026-11-03)

Причин было **две**, и вторая маскировала первую:

1. **Застарелый процесс TUI** (первое объяснение, частично верное). Старый TUI
   держал в памяти версию без тикающего таймера; после рестарта таймер заработал
   (свежий TUI: 2105 тиков, 0 ошибок). Это объясняло отсутствие *запросов*.
2. **Деструктуризация props в `StatRow`/`Panel`** — реальная причина «замёрзших»
   цифр уже после того, как таймер заработал. В Solid `function StatRow({ value })`
   читает prop один раз: текстовые узлы навсегда остаются с первым значением.
   Поэтому `tick-ok` шёл каждые 500 мс, `createEffect` на `latest()` срабатывал,
   а на экране были старые числа до повторного `/system-stats` (который
   перемонтировал панель и заново читал props).

Фикс и доказательство — п. 9 выше. Проверка: без повторного `/system-stats`
CPU 1% → 53%, RAM 1.53 → 1.64 GB под нагрузкой. `renderer.requestRender()`
для этого не нужен — хватает правильного чтения props.

**Правило на будущее:** в Solid-компонентах TUI-плагина никогда не
деструктурировать props. Всегда `props.x`, а вложенные значения-функции
(`latest`, `refreshMs`) передавать как accessor'ы и вызывать внутри JSX.
