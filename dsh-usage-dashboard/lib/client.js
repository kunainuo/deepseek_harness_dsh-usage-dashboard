// dsh-usage-dashboard - client half (persistent composition plugin).
// Browser bundle in the product __ModuleLoader__ format.
window.__ModuleLoader__.load({
  id: "dsh-usage-dashboard",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    // ── shared store (single fetch, all views sync) ─────────────────────────
    const store = {
      data: null,
      loading: false,
      error: null,
      started: false,
      listeners: new Set(),
      subscribe(fn) {
        this.listeners.add(fn);
        if (!this.started) {
          this.started = true;
          refresh();
        }
        return () => { this.listeners.delete(fn) };
      },
      notify() { this.listeners.forEach((fn) => fn()) }
    };

    async function refresh() {
      store.loading = true;
      store.notify();
      try {
        const res = await fetch("/usage-dashboard/data", { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        store.data = await res.json();
        store.error = null;
      } catch (e) {
        store.error = String((e && e.message) || e);
      }
      store.loading = false;
      store.notify();
    }

    function useStore() {
      const [, force] = react.useState(0);
      react.useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
      return store;
    }

    // ── floating-card UI state + auto-refresh ───────────────────────────────
    const ui = {
      visible: false,
      expanded: false,
      auto: true,
      intervalSec: 60,
      listeners: new Set(),
      set(patch) {
        if (patch.visible !== undefined) this.visible = patch.visible;
        if (patch.expanded !== undefined) this.expanded = patch.expanded;
        if (patch.auto !== undefined) this.auto = patch.auto;
        if (patch.intervalSec !== undefined) this.intervalSec = patch.intervalSec;
        applyAuto();
        this.listeners.forEach((fn) => fn());
      },
      subscribe(fn) {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn) };
      }
    };

    let timerApi = null;
    let autoTimer = null;

    function applyAuto() {
      if (autoTimer) {
        autoTimer();
        autoTimer = null;
      }
      if (ui.auto && timerApi) {
        autoTimer = timerApi.interval(() => {
          if (!store.loading) refresh();
        }, ui.intervalSec * 1000);
      }
    }

    function useUi() {
      const [, force] = react.useState(0);
      react.useEffect(() => ui.subscribe(() => force((n) => n + 1)), []);
      return { visible: ui.visible, expanded: ui.expanded, auto: ui.auto, intervalSec: ui.intervalSec };
    }

    // ── formatting helpers ──────────────────────────────────────────────────
    function fmtTokens(n) {
      const v = Number(n) || 0;
      if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
      if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
      return String(v);
    }

    function fmtMoney(v) {
      const num = Number(v);
      if (!isFinite(num)) return "-";
      return num.toFixed(2);
    }

    function fmtTime(ts) {
      if (!ts) return "-";
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    }

    function fmtInterval(sec) {
      if (sec >= 60) {
        const m = Math.round(sec / 60);
        return m + " 分钟";
      }
      return sec + " 秒";
    }

    // ── presentational components ────────────────────────────────────────────
    function Card(props) {
      return react.createElement("div", { className: "ud-card" },
        react.createElement("div", { className: "ud-card-label" }, props.label),
        react.createElement("div", { className: "ud-card-value" }, props.value),
        props.hint ? react.createElement("div", { className: "ud-card-hint" }, props.hint) : null
      );
    }

    function BalanceSection({ balance }) {
      if (!balance) return null;
      if (balance.error) return react.createElement("div", { className: "ud-error" }, "余额：" + balance.error);
      const info = balance.data && balance.data.balance_infos && balance.data.balance_infos[0];
      if (!info) return react.createElement("div", { className: "ud-error" }, "余额接口返回异常数据");
      return react.createElement("div", { className: "ud-section" },
        react.createElement("div", { className: "ud-section-title" }, "API 账户余额"),
        react.createElement("div", { className: "ud-cards" },
          react.createElement(Card, { label: "账户状态", value: balance.data.is_available ? "可用" : "不可用" }),
          react.createElement(Card, { label: "总余额", value: fmtMoney(info.total_balance) + " " + info.currency }),
          react.createElement(Card, { label: "充值余额", value: fmtMoney(info.topped_up_balance) + " " + info.currency }),
          react.createElement(Card, { label: "赠送余额", value: fmtMoney(info.granted_balance) + " " + info.currency })
        )
      );
    }

    function StatsSection({ usage }) {
      if (!usage) return null;
      if (usage.error) return react.createElement("div", { className: "ud-error" }, "Token 统计：" + usage.error);
      const t = usage.totals;
      return react.createElement("div", { className: "ud-section" },
        react.createElement("div", { className: "ud-section-title" }, "Token 消耗统计"),
        react.createElement("div", { className: "ud-cards" },
          react.createElement(Card, { label: "累计 Token", value: fmtTokens(t.input + t.output) }),
          react.createElement(Card, { label: "输入 Token", value: fmtTokens(t.input) }),
          react.createElement(Card, { label: "输出 Token", value: fmtTokens(t.output) }),
          react.createElement(Card, { label: "模型调用次数", value: String(t.calls) }),
          react.createElement(Card, { label: "统计会话", value: String(usage.scannedSessions) + " / " + String(usage.totalSessions), hint: usage.capped ? "仅统计最近 100 个会话" : "全部会话已统计" })
        )
      );
    }

    function DailyChart({ days }) {
      const max = days.reduce((m, d) => Math.max(m, (d.input || 0) + (d.output || 0)), 1);
      return react.createElement("div", { className: "ud-chart" },
        react.createElement("div", { className: "ud-chart-title" }, "近 14 天 Token 消耗（堆叠：输入 + 输出）"),
        react.createElement("div", { className: "ud-bars" },
          days.map((d) => {
            const input = d.input || 0;
            const output = d.output || 0;
            const hi = input === 0 ? 0 : Math.max(2, Math.round((input / max) * 100));
            const ho = output === 0 ? 0 : Math.max(2, Math.round((output / max) * 100));
            return react.createElement("div", { className: "ud-bar-col", key: d.day, title: d.day + "  输入 " + fmtTokens(input) + " / 输出 " + fmtTokens(output) },
              react.createElement("div", { className: "ud-bar-track" },
                react.createElement("div", { className: "ud-bar-output", style: { height: ho + "%" } }),
                react.createElement("div", { className: "ud-bar-input", style: { height: hi + "%" } })
              ),
              react.createElement("div", { className: "ud-bar-day" }, d.day.slice(5))
            );
          })
        )
      );
    }

    function ModelChart({ models }) {
      const max = models.reduce((m, x) => Math.max(m, x.input + x.output), 1);
      return react.createElement("div", { className: "ud-chart" },
        react.createElement("div", { className: "ud-chart-title" }, "按模型 Token 消耗"),
        models.length === 0
          ? react.createElement("div", { className: "ud-empty" }, "暂无数据")
          : models.map((m) => {
              const total = m.input + m.output;
              const w = Math.max(2, Math.round((total / max) * 100));
              return react.createElement("div", { className: "ud-hrow", key: m.model },
                react.createElement("div", { className: "ud-hlabel", title: m.model }, m.model),
                react.createElement("div", { className: "ud-htrack" },
                  react.createElement("div", { className: "ud-hfill", style: { width: w + "%" } })
                ),
                react.createElement("div", { className: "ud-hval" }, fmtTokens(total))
              );
            })
      );
    }

    function TopSessions({ list }) {
      if (!list || list.length === 0) return null;
      return react.createElement("div", { className: "ud-section" },
        react.createElement("div", { className: "ud-section-title" }, "消耗 TOP 会话"),
        react.createElement("table", { className: "ud-table" },
          react.createElement("thead", null,
            react.createElement("tr", null,
              react.createElement("th", null, "会话"),
              react.createElement("th", null, "创建时间"),
              react.createElement("th", null, "输入"),
              react.createElement("th", null, "输出"),
              react.createElement("th", null, "合计")
            )
          ),
          react.createElement("tbody", null,
            list.map((s) => react.createElement("tr", { key: s.id },
              react.createElement("td", { className: "ud-mono" }, s.id),
              react.createElement("td", null, fmtTime(s.createdAt)),
              react.createElement("td", null, fmtTokens(s.input)),
              react.createElement("td", null, fmtTokens(s.output)),
              react.createElement("td", null, fmtTokens(s.input + s.output))
            ))
          )
        )
      );
    }

    function AutoRefreshControl() {
      const s = useUi();
      return react.createElement("label", { className: "ud-auto" },
        react.createElement("span", { className: "ud-auto-label" }, "自动刷新"),
        react.createElement("input", {
          type: "checkbox",
          className: "ud-auto-check",
          checked: s.auto,
          onChange: (e) => ui.set({ auto: e.target.checked })
        }),
        react.createElement("select", {
          className: "ud-auto-select",
          value: String(s.intervalSec),
          disabled: !s.auto,
          onChange: (e) => ui.set({ intervalSec: Number(e.target.value) })
        },
          [30, 60, 300].map((v) => react.createElement("option", { key: String(v), value: String(v) }, fmtInterval(v)))
        )
      );
    }

    function DashboardContent({ data, loading, error, onRefresh, showTitle }) {
      const usage = data ? data.usage : null;
      const balance = data ? data.balance : null;
      return react.createElement("div", { className: "ud-wrap" },
        react.createElement("div", { className: "ud-header" },
          showTitle ? react.createElement("div", { className: "ud-title" }, "DSH 用量仪表盘") : null,
          react.createElement(AutoRefreshControl, null),
          react.createElement("button", { className: "ud-refresh", onClick: onRefresh, disabled: loading }, loading ? "刷新中…" : "刷新"),
          data ? react.createElement("div", { className: "ud-meta" }, "更新于 " + fmtTime(data.serverTime)) : null
        ),
        error ? react.createElement("div", { className: "ud-error" }, "加载失败：" + error) : null,
        !data && loading ? react.createElement("div", { className: "ud-empty" }, "正在收集数据…") : null,
        react.createElement(BalanceSection, { balance: balance }),
        react.createElement(StatsSection, { usage: usage }),
        react.createElement(DailyChart, { days: usage ? usage.days : [] }),
        react.createElement(ModelChart, { models: usage ? usage.models : [] }),
        react.createElement(TopSessions, { list: usage ? usage.topSessions : [] })
      );
    }

    function CompactView() {
      const s = useStore();
      const data = s.data;
      const usage = data ? data.usage : null;
      const balance = data ? data.balance : null;
      const t = usage && usage.totals;
      let balText = "…";
      if (balance && balance.error) balText = "查询失败";
      else if (balance && balance.data && balance.data.balance_infos && balance.data.balance_infos[0]) {
        const info = balance.data.balance_infos[0];
        balText = fmtMoney(info.total_balance) + " " + info.currency;
      }
      return react.createElement("div", { className: "ud-compact", onClick: () => ui.set({ expanded: true }) },
        react.createElement("div", { className: "ud-compact-row" },
          react.createElement("span", { className: "ud-compact-key" }, "总余额"),
          react.createElement("span", { className: "ud-compact-val" }, balText)
        ),
        react.createElement("div", { className: "ud-compact-row" },
          react.createElement("span", { className: "ud-compact-key" }, "累计 Token"),
          react.createElement("span", { className: "ud-compact-val" }, t ? fmtTokens(t.input + t.output) : "…")
        ),
        react.createElement("div", { className: "ud-compact-row" },
          react.createElement("span", { className: "ud-compact-key" }, "模型调用"),
          react.createElement("span", { className: "ud-compact-val" }, t ? String(t.calls) : "…")
        ),
        s.loading && !data ? react.createElement("div", { className: "ud-compact-hint" }, "正在收集数据…") : null,
        data ? react.createElement("div", { className: "ud-compact-hint" }, "更新于 " + fmtTime(data.serverTime)) : null
      );
    }

    function FloatingCard() {
      const s = useUi();
      const storeState = useStore();
      if (!s.visible) return null;
      return react.createElement("div", { className: "ud-float" + (s.expanded ? " ud-float-open" : "") },
        react.createElement("div", { className: "ud-float-head" },
          react.createElement("div", { className: "ud-float-title" },
            "DSH 用量",
            s.auto ? react.createElement("span", { className: "ud-auto-ind", title: "自动刷新：每 " + fmtInterval(s.intervalSec) }, "⏱ " + (s.intervalSec >= 60 ? Math.round(s.intervalSec / 60) + "m" : s.intervalSec + "s")) : null
          ),
          react.createElement("div", { className: "ud-float-actions" },
            react.createElement("button", { className: "ud-float-btn", title: s.expanded ? "收起" : "展开", onClick: () => ui.set({ expanded: !s.expanded }) }, s.expanded ? "—" : "＋"),
            react.createElement("button", { className: "ud-float-btn", title: "关闭", onClick: () => ui.set({ visible: false, expanded: false }) }, "✕")
          )
        ),
        s.expanded
          ? react.createElement("div", { className: "ud-float-body" },
              react.createElement(DashboardContent, { data: storeState.data, loading: storeState.loading, error: storeState.error, onRefresh: refresh, showTitle: false }))
          : react.createElement(CompactView, null)
      );
    }

    function FooterAction({ wide }) {
      const s = useUi();
      return react.createElement("button", {
        className: "ud-foot-btn",
        title: "用量仪表盘",
        onClick: () => ui.set({ visible: !s.visible })
      }, wide ? "用量" : "📊");
    }

    // ── plugin body ──────────────────────────────────────────────────────────
    const inject = ["slots"];

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      timerApi = ctx.get("timer");
      slots.inject("sidebar.footer.action", () => slots.register(
        { name: "sidebar.footer.action", id: "usage-dashboard", order: 30 },
        (props) => react.createElement(FooterAction, { wide: props.wide })
      ));
      slots.inject("shell.overlay", () => slots.register(
        { name: "shell.overlay", id: "usage-dashboard", order: 100 },
        () => react.createElement(FloatingCard, null)
      ));
      applyAuto();
    }

    // ── styles (product data-plugin-css singleton pattern) ───────────────────
    const css = [
      ".ud-wrap{display:flex;flex-direction:column;gap:12px;padding:12px;font-size:13px;color:var(--dsw-alias-label-primary);box-sizing:border-box;min-width:0}",
      ".ud-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      ".ud-title{font-size:15px;font-weight:600}",
      ".ud-refresh{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px}",
      ".ud-refresh:disabled{opacity:.6;cursor:default}",
      ".ud-meta{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".ud-error{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:8px 10px;font-size:12px}",
      ".ud-section{display:flex;flex-direction:column;gap:8px}",
      ".ud-section-title{font-size:13px;font-weight:600}",
      ".ud-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}",
      ".ud-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px}",
      ".ud-card-label{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".ud-card-value{font-size:16px;font-weight:600;margin-top:4px;word-break:break-all}",
      ".ud-card-hint{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:2px}",
      ".ud-chart{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px}",
      ".ud-chart-title{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}",
      ".ud-bars{display:flex;align-items:flex-end;gap:6px;height:140px}",
      ".ud-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;gap:4px;min-width:0}",
      ".ud-bar-track{flex:1;width:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:1px;background:var(--dsw-alias-bg-layer-2);border-radius:3px;overflow:hidden}",
      ".ud-bar-input{background:var(--dsw-alias-brand-primary);width:100%;border-radius:2px}",
      ".ud-bar-output{background:var(--dsw-alias-state-success-primary);width:100%;border-radius:2px}",
      ".ud-bar-day{font-size:10px;color:var(--dsw-alias-label-secondary)}",
      ".ud-empty{color:var(--dsw-alias-label-secondary);padding:8px 0}",
      ".ud-hrow{display:flex;align-items:center;gap:8px;margin-bottom:6px}",
      ".ud-hlabel{width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;flex:none}",
      ".ud-htrack{flex:1;background:var(--dsw-alias-bg-layer-2);border-radius:4px;height:14px;overflow:hidden}",
      ".ud-hfill{height:100%;background:var(--dsw-alias-brand-primary);border-radius:4px}",
      ".ud-hval{width:64px;text-align:right;font-size:12px;font-weight:600;flex:none}",
      ".ud-table{width:100%;border-collapse:collapse;font-size:12px}",
      ".ud-table th,.ud-table td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
      ".ud-table th{color:var(--dsw-alias-label-secondary);font-weight:500}",
      ".ud-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}",
      ".ud-foot-btn{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;line-height:1;margin:0 4px}",
      ".ud-float{position:fixed;right:16px;bottom:16px;width:300px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);overflow:hidden;pointer-events:auto;font-size:13px;color:var(--dsw-alias-label-primary)}",
      ".ud-float-open{width:560px;max-width:calc(100vw - 32px)}",
      ".ud-float-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
      ".ud-float-title{font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px}",
      ".ud-auto-ind{font-size:11px;font-weight:400;color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:1px 6px}",
      ".ud-float-actions{display:flex;gap:6px}",
      ".ud-float-btn{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;width:24px;height:24px;cursor:pointer;font-size:12px;line-height:1}",
      ".ud-float-body{max-height:70vh;overflow-y:auto;padding:10px 12px}",
      ".ud-compact{display:flex;flex-direction:column;gap:6px;padding:10px 12px;cursor:pointer}",
      ".ud-compact-row{display:flex;justify-content:space-between;gap:8px}",
      ".ud-compact-key{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".ud-compact-val{font-weight:600;font-size:12px}",
      ".ud-compact-hint{color:var(--dsw-alias-label-secondary);font-size:11px}",
      ".ud-auto{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".ud-auto-check{accent-color:var(--dsw-alias-brand-primary);cursor:pointer}",
      ".ud-auto-select{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font-size:12px;padding:2px 4px;cursor:pointer}"
    ].join("\n");
    const tagId = "dsh-usage-dashboard/styles.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-usage-dashboard";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
