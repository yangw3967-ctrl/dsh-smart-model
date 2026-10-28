// dsh-smart-model — Client half.
// Watches the composer draft of the current session and, when the draft
// clearly matches a task profile, switches the session's model + reasoning
// level via the ModelDirectory API. A small status chip in the composer
// dock shows the current pick and pauses/resumes the automation.
// Runtime heartbeat: every interesting fact is POSTed to the host's
// /dsh-smart-model/log route (see index.js), which appends it to
// heartbeat.log in the bundle directory. When the host route is absent,
// every report is silently dropped.
window.__ModuleLoader__.load({
  id: '@local/dsh-smart-model',
  factory(require) {
    const React = require('react');
    const { useEffect, useState, useRef } = React;

    let rootCtx = null;
    let appliedCtx = null;

    const MODEL_FLASH = 'deepseek-flash';
    const MODEL_PRO = 'deepseek-v4-pro';

    const EFFORT_LABEL = {
      zh: { off: '关', low: '低', high: '高', max: '最大' },
      en: { off: 'Off', low: 'Low', high: 'High', max: 'Max' },
    };
    const MODEL_LABEL = { [MODEL_FLASH]: 'Flash', [MODEL_PRO]: 'V4-Pro' };

    function report(ev, data) {
      try {
        void fetch('/dsh-smart-model/log', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ev, ...data }),
          keepalive: true,
        }).catch(() => {});
      } catch { /* never break the page */ }
    }

    // ------------------------------------------------------------------
    // Classification. Rules are scored by keyword hits (zh: substring,
    // en: whole word); ties go to the later (more capable) rule.
    // decision: { model: 'flash'|'pro', effort: 'off'|'low'|'high'|'max' }
    // (effort 一律显式传递: 省略 = 沿用会话当前等级, 这正是"该关没关"的坑)
    // ------------------------------------------------------------------
    const RULES = [
      {
        // 琐碎事实/查询/格式 — 快, 不需要思考
        id: 'trivial', model: 'flash', effort: 'off',
        zh: ['几点了', '现在几点', '今天几号', '今天星期几', '星期几', '日期', '天气',
          '温度', '湿度', '汇率', '换算', '单位', '等于多少', '怎么拼', '拼写',
          '怎么读', '怎么念', '什么意思', '摄氏度', '华氏度', '大写', '小写',
          '去空格', '加逗号', '排序', '格式', '几岁', '多远', '多高'],
        en: ['what time', 'what day', 'today', 'weather', 'spell', 'pronounce',
          'convert', 'how much is', 'uppercase', 'lowercase', 'sort this', 'format this'],
      },
      {
        // 轻量生成/常规润色/简短任务 — 低推理足够
        id: 'light', model: 'flash', effort: 'low',
        zh: ['起名', '取名', '起标题', '标题', '文案', '朋友圈', '自我介绍', '祝福语',
          '贺词', '请假条', '道歉信', '会议纪要', '一句话', '简短', '润色', '通顺',
          '错别字', '病句', '语法', '改写', '翻译', '一行命令', '正则', '变量命名',
          '重命名', '邮件', '总结', '摘要', '缩写', '扩写', '仿写', '口号', '标语',
          '广告词', '回复模板'],
        en: ['name for', 'title for', 'slogan', 'tagline', 'short email', 'email',
          'draft', 'reply', 'polish', 'proofread', 'grammar', 'rephrase', 'rewrite',
          'translate', 'one-liner', 'regex', 'rename', 'summarize', 'summary'],
      },
      {
        // 编程/分析/复杂写作/数学推理 — 默认的严肃工作档
        id: 'standard', model: 'pro', effort: 'high',
        zh: ['代码', '程序', '脚本', '函数', '类', '接口', 'api', 'bug', '报错', '错误',
          '异常', '调试', '排查', '修复', '重构', '优化', '性能', '架构', '设计',
          '算法', '数据结构', '单元测试', '测试', '部署', '配置', '环境', '数据库',
          'sql', '前端', '后端', '全栈', 'python', 'javascript', 'typescript', 'c++',
          'java', 'rust', 'golang', 'go', 'linux', 'docker', 'git', 'nginx',
          'kubernetes', '微服务', '论文', '报告', '方案', '计划', '大纲', '文档',
          '调研', '分析', '对比', '评估', '梳理', '解读', '原理', '为什么', '怎么实现',
          '如何实现', '数学', '证明', '推理', '逻辑', '概率', '统计', '方程', '几何',
          '积分', '导数', '复杂度', '设计模式', '协议', '编译', '内存', '并发', '线程',
          '进程'],
        en: ['code', 'program', 'script', 'function', 'class', 'interface', 'api',
          'bug', 'error', 'exception', 'debug', 'investigate', 'fix', 'refactor',
          'optimize', 'performance', 'architecture', 'design', 'algorithm',
          'data structure', 'unit test', 'test', 'deploy', 'configure', 'environment',
          'database', 'sql', 'frontend', 'backend', 'full-stack', 'python',
          'javascript', 'typescript', 'rust', 'golang', 'linux', 'docker', 'git',
          'nginx', 'kubernetes', 'microservice', 'paper', 'report', 'proposal',
          'plan', 'outline', 'document', 'research', 'analysis', 'analyze', 'compare',
          'evaluate', 'principle', 'why', 'how does', 'how to implement', 'math',
          'prove', 'proof', 'reasoning', 'logic', 'probability', 'statistics',
          'equation', 'calculus', 'protocol', 'concurrency', 'thread', 'memory'],
      },
      {
        // 最难档 — 严格推理/审计/法律/重大决策, 显式要求深思
        id: 'deep', model: 'pro', effort: 'max',
        zh: ['数学证明', '证明', '证明题', '数学题', '定理', '猜想', '素数', '竞赛',
          '奥数', '难题', '复杂算法', '逻辑题', '推理题', '形式化', '安全审计', '漏洞',
          '渗透', '密码学', '加密', '解密', '合同', '法律', '条款', '诉讼', '仲裁',
          '医学', '诊断', '鉴别诊断', '审稿', '评审', '仔细', '仔细思考', '深思',
          '认真推理', '一步一步', '严格', '严谨', '权衡', '决策', '重大', '风险',
          '悖论', '争议', '逐行', '仔细检查', '深入分析', '深度思考', '边缘情况',
          '极端情况', '边界条件', '歧义'],
        en: ['formal proof', 'proof problem', 'olympiad', 'hard problem', 'np-complete',
          'complexity', 'formal verification', 'security audit', 'vulnerability',
          'exploit', 'penetration', 'cryptography', 'encryption', 'decryption',
          'contract', 'legal', 'lawsuit', 'arbitration', 'medical', 'diagnosis',
          'peer review', 'think step by step', 'carefully', 'rigorously', 'rigorous',
          'thorough', 'edge cases', 'corner cases', 'deep analysis', 'think deeply',
          'trade-offs', 'major decision', 'risk assessment', 'paradox'],
      },
    ];

    function escapeRegExp(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function scoreRule(rule, text) {
      let score = 0;
      const lower = text.toLowerCase();
      for (const kw of rule.zh) if (text.includes(kw)) score += 1;
      for (const kw of rule.en) {
        if (new RegExp('\\b' + escapeRegExp(kw) + '\\b', 'i').test(lower)) score += 1;
      }
      return score;
    }

    function classify(text) {
      if (!text) return null;
      // 斜杠命令草稿不参与分类, 避免干扰命令输入
      if (text.trimStart().startsWith('/')) return null;
      const len = text.length;
      let best = null;
      let bestScore = 0;
      for (const rule of RULES) {
        let s = scoreRule(rule, text);
        if (s === 0) continue;
        // 长文本偏向更严肃的档位
        if (len > 400 && (rule.id === 'standard' || rule.id === 'deep')) s += 1;
        if (len > 1500 && (rule.id === 'standard' || rule.id === 'deep')) s += 1;
        if (s >= bestScore) { best = rule; bestScore = s; }
      }
      return best;
    }

    // ------------------------------------------------------------------
    // Switch logic
    // ------------------------------------------------------------------
    const timers = new Map();          // sessionId -> setTimeout
    const autoBySession = new Map();   // sessionId -> boolean (default true)
    const lastApplied = new Map();     // sessionId -> { model, effort, ts }

    const DEBOUNCE_MS = 1000;
    const COOLDOWN_MS = 8000;

    function scheduleClassify(sessionId, draft) {
      const prev = timers.get(sessionId);
      if (prev !== undefined) clearTimeout(prev);
      timers.set(sessionId, setTimeout(() => {
        timers.delete(sessionId);
        if (autoBySession.get(sessionId) === false) return;
        const decision = classify(draft);
        if (!decision) {
          report('classify-none', { len: draft.length });
          return;
        }
        report('classify', {
          rule: decision.id,
          model: decision.model,
          effort: decision.effort ?? null,
          len: draft.length,
        });
        applyDecision(sessionId, decision).catch(() => {});
      }, DEBOUNCE_MS));
    }

    /**
     * Resolve the session's model directory. The `modelDirectories` service is
     * registered after this plugin applies, so ctx.get() returns null at mount
     * time: look again on every use, and only report a miss when it is really
     * missing at call time.
     */
    function modelDirectoryFor(sessionId) {
      let models = null;
      try { models = rootCtx?.get?.('modelDirectories') ?? null; } catch { models = null; }
      if (!models) {
        report('apply-error', { message: 'no modelDirectories service', hasRootCtx: Boolean(rootCtx) });
        return null;
      }
      try { return models.directoryFor(sessionId) ?? null; } catch (error) {
        report('apply-error', { message: 'directoryFor: ' + String(error?.message ?? error) });
        return null;
      }
    }

    const PICKABLE_PHASES = new Set(['plain', 'idle', 'blank']);

    async function applyDecision(sessionId, decision) {
      try {
        const sessions = rootCtx?.get?.('sessions');
        // 子代理会话不可选模型
        if (sessions?.subagentAddress?.(sessionId) !== undefined) return;

        const directory = modelDirectoryFor(sessionId);
        if (!directory) return;
        try { await directory.load(); } catch (error) {
          report('apply-error', { message: 'load: ' + String(error?.message ?? error) });
          return;
        }

        const snap = directory.store.getSnapshot();
        const targetModel = decision.model === 'flash' ? MODEL_FLASH : MODEL_PRO;
        const inCatalog = (snap.groups || []).some(
          (g) => (g.models || []).some((m) => m.id === targetModel)
        );
        if (!inCatalog) {
          report('apply-skip', { reason: 'not-in-catalog', target: targetModel, groupCount: snap.groups?.length ?? 0 });
          return;
        }

        const current = snap.current;
        const sameModel = current?.model === targetModel;
        const sameEffort = current?.reasoningEffort === decision.effort;
        if (sameModel && sameEffort) {
          report('apply-skip', { reason: 'already-selected', model: current?.model, effort: current?.reasoningEffort ?? null });
          return;
        }

        const now = Date.now();
        const last = lastApplied.get(sessionId);
        if (last && now - last.ts < COOLDOWN_MS) {
          report('apply-skip', { reason: 'cooldown' });
          return;
        }

        const provider = current?.provider || 'deepseek-account';
        const selection = { provider, model: targetModel, reasoningEffort: decision.effort };

        report('select', { provider, model: targetModel, effort: decision.effort ?? null });
        const result = await directory.select(selection);
        if (!result.ok) {
          report('select-fail', { code: result.error?.code ?? 'unknown', message: result.error?.message ?? '' });
          if (result.error?.code === 'session/writer-held') return; // 会话正在输出, 静默
          console.warn('[dsh-smart-model] select failed:', result.error);
          return;
        }
        report('select-ok', { model: targetModel, effort: decision.effort ?? null });
        lastApplied.set(sessionId, { model: targetModel, effort: decision.effort, ts: now });
      } catch (error) {
        report('apply-error', { message: String(error?.message ?? error) });
      }
    }

    // ------------------------------------------------------------------
    // Status chip in the composer dock.
    // ------------------------------------------------------------------
    function Chip(props) {
      const sessionId = props.sessionId;
      const [auto, setAuto] = useState(true);
      const [pick, setPick] = useState(null);

      const hasUseInput = typeof props.useInput === 'function';
      // useInput 是选择器 hook: 必须选择基本值, 选择器结果变化才触发重渲染。
      // (用 (s)=>s 返回整个状态对象时, 引用稳定, 组件永远不会因草稿变化而刷新。)
      let draft = '';
      let phase;
      try {
        draft = hasUseInput ? (props.useInput((s) => s.draft) ?? '') : '';
        phase = hasUseInput ? props.useInput((s) => s.phase) : undefined;
      } catch { draft = ''; phase = undefined; }
      if (typeof draft !== 'string') draft = '';

      const firstRender = useRef(true);
      const lastDraftLen = useRef(-1);
      const lastPhase = useRef(undefined);

      useEffect(() => {
        report('chip-mount', {
          sessionId: String(sessionId ?? ''),
          propKeys: Object.keys(props).join(','),
          hasUseInput,
          hasInputActions: typeof props.inputActions === 'object',
          hasUseConversation: typeof props.useConversation === 'function',
          hasUseSession: typeof props.useSession === 'function',
        });
      }, []);

      // 同步会话级自动开关
      useEffect(() => {
        if (!sessionId) return;
        autoBySession.set(sessionId, auto);
      }, [sessionId, auto]);

      // 草稿变化 → 防抖分类(输出中/提交中不动)
      useEffect(() => {
        if (!sessionId) return;
        if (phase !== lastPhase.current) {
          lastPhase.current = phase;
          report('phase', { phase: String(phase), draftLen: draft.length });
        }
        if (!draft || !PICKABLE_PHASES.has(phase)) return;
        if (draft.length !== lastDraftLen.current) {
          lastDraftLen.current = draft.length;
          report('draft', { len: draft.length, phase: String(phase) });
        }
        scheduleClassify(sessionId, draft);
      }, [sessionId, draft, phase]);

      // 兜底: useInput 缺失时, 退回服务面 shell(sessionId) 订阅
      useEffect(() => {
        if (!sessionId || !rootCtx || hasUseInput) return;
        let conversation = null;
        try { conversation = rootCtx.get?.('conversation') ?? null; } catch { conversation = null; }
        let shell;
        try { shell = conversation?.input?.shell(sessionId); } catch { shell = undefined; }
        if (!shell || typeof shell.state?.subscribe !== 'function') {
          report('fallback-missing', { hasConversation: Boolean(conversation), hasShell: Boolean(shell) });
          return;
        }
        let offDraft;
        try {
          offDraft = shell.state.subscribe(() => {
            const s = shell.state.getSnapshot();
            if (!PICKABLE_PHASES.has(s.phase)) return;
            scheduleClassify(sessionId, typeof s.draft === 'string' ? s.draft : '');
          });
        } catch { return; }
        return () => {
          offDraft?.();
          const t = timers.get(sessionId);
          if (t !== undefined) clearTimeout(t);
          timers.delete(sessionId);
        };
      }, [sessionId, hasUseInput]);

      // 订阅模型目录, 同步显示当前选择
      useEffect(() => {
        if (!sessionId || !rootCtx) return;
        let offDir;
        let dir = null;
        try { dir = modelDirectoryFor(sessionId); } catch { dir = null; }
        if (!dir) {
          report('dir-missing', { sessionId: String(sessionId) });
          return;
        }
        try {
          dir.load().catch(() => {});
          const sync = () => setPick(dir.store.getSnapshot().current);
          if (typeof dir.store?.subscribe === 'function') offDir = dir.store.subscribe(sync);
          sync();
        } catch { /* 目录不可用就只显示占位 */ }
        return () => { offDir?.(); };
      }, [sessionId]);

      const zh = (globalThis.document?.documentElement?.lang || '').toLowerCase().startsWith('zh');
      const effortLabels = EFFORT_LABEL[zh ? 'zh' : 'en'];
      const chipBase = {
        type: 'button',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          fontSize: '11px', lineHeight: '18px', padding: '0 8px',
          borderRadius: '9px', border: '1px solid rgba(128,128,128,.35)',
          cursor: 'pointer', whiteSpace: 'nowrap', opacity: '.95',
        },
      };

      if (!sessionId) {
        if (firstRender.current) {
          firstRender.current = false;
          report('chip-no-session', { propKeys: Object.keys(props).join(',') });
        }
        return React.createElement('button', {
          ...chipBase,
          type: 'button',
          title: 'dsh-smart-model: 未收到会话信息',
          style: { ...chipBase.style, background: 'rgba(255,150,0,.14)', cursor: 'default' },
        }, '⚡ 未挂载');
      }

      const effort = pick?.reasoningEffort == null
        ? effortLabels.off
        : effortLabels[pick?.reasoningEffort] ?? String(pick.reasoningEffort);
      const modelLabel = MODEL_LABEL[pick?.model] ?? (pick?.model || '…');
      const title = auto
        ? (zh ? '智能选择已开启, 点击暂停' : 'Auto selection on, click to pause')
        : (zh ? '智能选择已暂停, 点击恢复' : 'Auto selection paused, click to resume');

      if (firstRender.current) {
        firstRender.current = false;
        report('chip-render', { model: pick?.model ?? null, effort: pick?.reasoningEffort ?? null, auto });
      }

      return React.createElement('button', {
        ...chipBase,
        type: 'button',
        title,
        onClick: () => setAuto((a) => !a),
        style: {
          ...chipBase.style,
          background: auto ? 'rgba(100,180,255,.14)' : 'rgba(128,128,128,.10)',
          color: auto ? 'inherit' : 'rgba(128,128,128,.7)',
        },
      }, (auto ? '⚡ ' : '⏸ ') + modelLabel + ' · ' + effort);
    }

    // ------------------------------------------------------------------
    // Entry
    // ------------------------------------------------------------------
    const plugin = {
      inject: ['slots'],
      apply(ctx) {
        if (appliedCtx === ctx) return;
        appliedCtx = ctx;
        rootCtx = ctx;
        let conversationKind = 'missing';
        let modelsKind = 'missing';
        try { conversationKind = ctx.get('conversation') === null || ctx.get('conversation') === undefined ? 'null' : 'ok'; } catch { conversationKind = 'throws'; }
        try { modelsKind = ctx.get('modelDirectories') === null || ctx.get('modelDirectories') === undefined ? 'null' : 'ok'; } catch { modelsKind = 'throws'; }
        report('apply-start', {
          slotsInject: typeof ctx?.slots?.inject,
          slotsRegister: typeof ctx?.slots?.register,
          conversation: conversationKind,
          modelDirectories: modelsKind,
        });
        const mount = (slotName) => ctx.slots.inject(slotName, () => ctx.slots.register({
          name: slotName,
          id: 'dsh-smart-model',
          order: 60,
        }, Chip));
        mount('conversation.composer.dock');
        mount('conversation.hero.options');
        report('apply-done');
      },
    };
    // 测试钩子: 仅当外部显式开启(浏览器中不开启, 不影响加载)
    if (globalThis.__DSH_SMART_MODEL_TEST === true) {
      globalThis.__dshSmartModelTest = { classify, plugin };
    }
    return plugin;
  },
});
