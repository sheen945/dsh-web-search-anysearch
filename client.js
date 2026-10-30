window.__ModuleLoader__.load({
  id: 'dsh-web-search-anysearch',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'plugin.anysearchSearch';
    /** Settings namespace (`web` row) the provider selection lives in. */
    const WEB_NS = 'web';
    /** Field inside that namespace. */
    const FIELD = 'searchProvider';
    /** Provider id this bundle registers. */
    const ANYSEARCH = 'anysearch';
    /** The built-in provider to fall back to. */
    const FALLBACK = 'deepseek-official';

    const zh = {
      title: '网页搜索 · AnySearch',
      summaryOn: '已启用：web_search 由 AnySearch 提供，密钥已预置。',
      summaryOff: '未启用：web_search 走 DeepSeek 官方。',
      summaryUnavailable: '设置尚未就绪。',
      choice: '搜索提供方',
      anysearch: 'AnySearch',
      fallback: 'DeepSeek 官方',
      hint: '用 AnySearch（api.anysearch.com）提供 web_search；端点、密钥与客户端标识已随插件写好，无需填写。选 DeepSeek 官方即回退到内置搜索。',
      endpoint: '端点',
      endpointValue: 'https://api.anysearch.com/mcp（MCP streamable HTTP）',
      key: '密钥',
      keyValue: '已预置在插件配置中',
      client: '客户端标识',
      clientValue: 'mcp/1.0.0',
      saving: '保存中…',
      saved: '已生效',
      saveFailed: '本部署没有接受这次改动。',
      readOnly: '本部署的设置为只读。',
      unavailable: '设置尚未从 Host 载入完成。',
      current: '当前',
    };

    const en = {
      title: 'Web search · AnySearch',
      summaryOn: 'Enabled: web_search runs on AnySearch with a preconfigured key.',
      summaryOff: 'Disabled: web_search uses DeepSeek official.',
      summaryUnavailable: 'Settings are not ready yet.',
      choice: 'Search provider',
      anysearch: 'AnySearch',
      fallback: 'DeepSeek official',
      hint: 'AnySearch (api.anysearch.com) serves web_search. Endpoint, key, and client id ship with the plugin — nothing to fill in. Choose DeepSeek official to fall back to the built-in search.',
      endpoint: 'Endpoint',
      endpointValue: 'https://api.anysearch.com/mcp (MCP streamable HTTP)',
      key: 'API key',
      keyValue: 'Preconfigured in the plugin',
      client: 'Client id',
      clientValue: 'mcp/1.0.0',
      saving: 'Saving…',
      saved: 'Applied',
      saveFailed: 'The deployment did not accept this change.',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'Settings are still loading from the Host.',
      current: 'Current',
    };

    const styles = {
      wrap: { display: 'grid', gap: '10px' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' },
      label: { color: 'var(--dsw-alias-label-primary)', fontSize: '13px', lineHeight: 1.5 },
      segment: {
        display: 'inline-flex',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        overflow: 'hidden',
      },
      option: {
        appearance: 'none',
        border: '0',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        fontSize: '12px',
        lineHeight: 1.5,
        padding: '5px 12px',
      },
      optionActive: {
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontWeight: 600,
      },
      optionDisabled: { cursor: 'not-allowed', opacity: 0.6 },
      hint: { color: 'var(--dsw-alias-label-secondary)', margin: 0, fontSize: '12px', lineHeight: 1.5 },
      statusOk: { color: 'var(--dsw-alias-state-success-primary)', margin: 0, fontSize: '12px' },
      statusBad: { color: 'var(--dsw-alias-state-error-primary)', margin: 0, fontSize: '12px' },
      panel: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        padding: '10px 12px',
        display: 'grid',
        gap: '4px',
        fontSize: '12px',
        lineHeight: 1.6,
      },
      infoRow: { display: 'flex', gap: '8px' },
      infoKey: { color: 'var(--dsw-alias-label-secondary)', minWidth: '84px' },
      infoValue: { color: 'var(--dsw-alias-label-primary)' },
    };

    function merged(base, extra) {
      return Object.assign({}, base, extra);
    }

    /** Subscribe one React component to a ConfigFormController snapshot. */
    function useFormSnapshot(form) {
      const [snapshot, setSnapshot] = React.useState(() => form.getSnapshot());
      React.useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [form]);
      return snapshot;
    }

    function infoRow(label, value) {
      return h('div', { style: styles.infoRow }, h('span', { style: styles.infoKey }, label), h('span', { style: styles.infoValue }, value));
    }

    function optionButton(key, text, active, disabled, onClick) {
      return h(
        'button',
        {
          key,
          type: 'button',
          style: merged(merged(styles.option, active ? styles.optionActive : {}), disabled ? styles.optionDisabled : {}),
          disabled,
          'aria-pressed': active,
          onClick,
        },
        text,
      );
    }

    function AnySearchCard(props) {
      const t = props.t;
      const form = props.webForm;
      const snapshot = useFormSnapshot(form);
      const [busy, setBusy] = React.useState(false);
      const [failed, setFailed] = React.useState(false);
      const [saved, setSaved] = React.useState(false);

      const ready = snapshot.status === 'ready' && snapshot.value !== undefined;
      const writable = ready && snapshot.writable !== false;
      const current = ready ? snapshot.value[FIELD] : undefined;
      const isAnySearch = current === ANYSEARCH;
      const base = ready ? snapshot.base?.[FIELD] : undefined;
      const settled = ready && current !== undefined;

      if (props.view === 'summary') {
        if (!ready) return t('summaryUnavailable');
        return t(isAnySearch ? 'summaryOn' : 'summaryOff');
      }

      const choose = (target) => {
        if (!writable || busy || target === current) return;
        setBusy(true);
        setFailed(false);
        setSaved(false);
        const write = target === base ? form.unset(FIELD) : form.set(FIELD, target);
        Promise.resolve(write)
          .then((accepted) => {
            if (accepted === false) setFailed(true);
            else setSaved(true);
          })
          .catch(() => setFailed(true))
          .then(() => setBusy(false));
      };

      return h(
        'div',
        { style: styles.wrap },
        h(
          'div',
          { style: styles.row },
          h('span', { style: styles.label }, t('choice')),
          h(
            'div',
            { style: styles.segment, role: 'group', 'aria-label': t('choice') },
            optionButton('anysearch', t('anysearch'), isAnySearch, !writable || busy, () => choose(ANYSEARCH)),
            optionButton('deepseek', t('fallback'), settled && !isAnySearch, !writable || busy, () => choose(FALLBACK)),
          ),
        ),
        h('p', { style: styles.hint }, t('hint')),
        !ready ? h('p', { style: styles.hint }, t('unavailable')) : null,
        ready && !writable ? h('p', { style: styles.statusBad }, t('readOnly')) : null,
        busy ? h('p', { style: styles.hint }, t('saving')) : null,
        !busy && failed ? h('p', { style: styles.statusBad }, t('saveFailed')) : null,
        !busy && !failed && saved ? h('p', { style: styles.statusOk }, t('saved')) : null,
        h(
          'div',
          { style: styles.panel },
          infoRow(t('endpoint'), t('endpointValue')),
          infoRow(t('key'), t('keyValue')),
          infoRow(t('client'), t('clientValue')),
          infoRow(t('current'), settled ? (isAnySearch ? t('anysearch') : t('fallback')) : '—'),
        ),
      );
    }

    const inject = ['slots', 'locale', 'configForms'];

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'anysearch: dictionaries');
      const form = ctx.configForms.get(WEB_NS);
      ctx.effect(
        () =>
          ctx.configForms.whileServed([WEB_NS], () =>
            ctx.slots.inject('plugins.item', () =>
              ctx.slots.register(
                {
                  name: 'plugins.item',
                  id: 'anysearch',
                  order: 21,
                  label: () => t('title'),
                  locale: NS,
                  inject: () => ({ webForm: form }),
                },
                AnySearchCard,
              ),
            ),
          ),
        'anysearch: page',
      );
    }

    return { inject, apply };
  },
});
