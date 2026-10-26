import { useEffect, useRef, useState } from "react";
import InstagramConnectionPanel from "./components/InstagramConnectionPanel";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileImage,
  FlaskConical,
  Instagram,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import AutomationWizard, {
  type Automation,
  type AutomationInput,
  type Post,
} from "./components/AutomationWizard";

type Section = "overview" | "automations" | "posts" | "history" | "settings";
type AutomationRecord = Automation & {
  post?: Post;
  counts?: { sent: number; pending: number; skipped: number };
};
type Delivery = {
  id: string;
  automationId: string;
  username: string;
  comment: string;
  status: "sent" | "pending_follow" | "skipped";
  reason: string;
  mode: string;
  createdAt: string;
  nonFollowerMessage?: string;
  message?: {
    text: string;
    imageUrl?: string;
    links?: { label: string; url: string }[];
  };
  reply?: string;
};
type Overview = {
  stats: {
    automations: number;
    activeAutomations: number;
    sent: number;
    pending: number;
    skipped: number;
  };
  activity: { date: string; label: string; sent: number; pending: number }[];
  recentDeliveries: Delivery[];
};
const sectionNames: Record<Section, string> = {
  overview: "대시보드",
  automations: "댓글 · DM 자동화",
  posts: "내 콘텐츠",
  history: "발송 기록",
  settings: "계정 및 설정",
};
const statusNames = {
  sent: "테스트 발송",
  pending_follow: "팔로우 확인 대기",
  skipped: "조건 미충족",
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ||
        "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  return data;
}
function dateLabel(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function Media({ post, className = "" }: { post?: Post; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`media ${className}`}
      style={{
        background: `linear-gradient(145deg, ${post?.kind === "REEL" ? "#e6dcd0, #a5b0a4" : "#d9e5df, #8eaa9c"})`,
      }}
    >
      {post?.thumbnail && !broken ? (
        <img
          src={post.thumbnail}
          alt={post.title}
          onError={() => setBroken(true)}
          loading="lazy"
        />
      ) : (
        <FileImage size={30} />
      )}
      <span className="media-kind">
        {post?.kind === "REEL" ? (
          <Play size={10} fill="currentColor" />
        ) : (
          <FileImage size={10} />
        )}{" "}
        {post?.kind === "REEL" ? "릴스" : "게시물"}
      </span>
    </div>
  );
}
function Dialog({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key === "Tab") {
        const items = box.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === box.current)
        ) {
          event.preventDefault();
          last.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog ${wide ? "dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={box}
        tabIndex={-1}
      >
        <div className="dialog-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [section, setSection] = useState<Section>("automations");
  const [posts, setPosts] = useState<Post[]>([]);
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [wizard, setWizard] = useState(false);
  const [initialPostId, setInitialPostId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Automation | null>(null);
  const [toast, setToast] = useState("");
  const [testing, setTesting] = useState(false);
  const [testAutomationId, setTestAutomationId] = useState("");
  const [testUsername, setTestUsername] = useState("noah_friend");
  const [testComment, setTestComment] = useState("정보 궁금해요!");
  const [testFollows, setTestFollows] = useState(false);
  const [testResult, setTestResult] = useState<Delivery | null>(null);
  const [testError, setTestError] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const [detail, setDetail] = useState<Delivery | null>(null);
  const [guide, setGuide] = useState(false);
  const [pendingAction, setPendingAction] = useState("");

  async function refresh() {
    const [p, a, d, o] = await Promise.all([
      api<{ posts: Post[] }>("/posts"),
      api<{ automations: AutomationRecord[] }>("/automations"),
      api<{ deliveries: Delivery[] }>("/deliveries"),
      api<Overview>("/overview"),
    ]);
    setPosts(p.posts);
    setAutomations(a.automations);
    setDeliveries(d.deliveries);
    setOverview(o);
  }
  useEffect(() => {
    refresh()
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  function notify(message: string) {
    setToast(message);
  }
  function openCreate(postId?: string) {
    setEditing(null);
    setInitialPostId(postId);
    setWizard(true);
  }
  function openTest(automation?: Automation) {
    const selected =
      automation ||
      automations.find((a) => a.status === "active") ||
      automations[0];
    setTestAutomationId(selected?.id || "");
    setTestComment(
      selected?.keywords[0]
        ? `${selected.keywords[0]} 보내주세요!`
        : "정보 궁금해요!",
    );
    setTestResult(null);
    setTestError("");
    setTestFollows(false);
    setTesting(true);
  }
  async function saveAutomation(payload: AutomationInput) {
    await api(editing ? `/automations/${editing.id}` : "/automations", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify({ ...payload, status: editing?.status ?? "active" }),
    });
    await refresh();
    setWizard(false);
    notify(
      editing
        ? "자동화 설정을 수정했어요."
        : "새 자동화를 저장했어요. 댓글 테스트로 확인해 보세요.",
    );
  }
  async function toggleAutomation(a: Automation) {
    setPendingAction(a.id);
    try {
      await api(`/automations/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: a.status === "active" ? "paused" : "active",
        }),
      });
      await refresh();
      notify(
        a.status === "active"
          ? "자동화를 일시 중지했어요."
          : "자동화를 다시 활성화했어요.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setPendingAction("");
    }
  }
  async function deleteAutomation() {
    if (!deleting) return;
    setPendingAction(deleting.id);
    try {
      await api(`/automations/${deleting.id}`, { method: "DELETE" });
      await refresh();
      setDeleting(null);
      notify("자동화를 삭제했어요.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setPendingAction("");
    }
  }
  async function runTest(event: React.FormEvent) {
    event.preventDefault();
    setTestBusy(true);
    setTestError("");
    setTestResult(null);
    try {
      const r = await api<{ delivery: Delivery }>("/simulate", {
        method: "POST",
        body: JSON.stringify({
          automationId: testAutomationId,
          username: testUsername,
          comment: testComment,
          isFollower: testFollows,
        }),
      });
      setTestResult(r.delivery);
      await refresh();
    } catch (e) {
      setTestError((e as Error).message);
    } finally {
      setTestBusy(false);
    }
  }
  async function verifyFollow(delivery: Delivery) {
    setTestBusy(true);
    try {
      const r = await api<{ delivery: Delivery }>(
        `/deliveries/${delivery.id}/verify-follow`,
        { method: "POST", body: JSON.stringify({ isFollower: true }) },
      );
      setTestResult(r.delivery);
      if (detail) setDetail(r.delivery);
      await refresh();
      notify("팔로우 확인 후 DM 발송을 테스트했어요.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setTestBusy(false);
    }
  }
  function exportHistory() {
    const field = (value: string) =>
      `"${(/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
    const lines = [
      ["시간", "사용자", "댓글", "상태", "모드"],
      ...deliveries.map((d) => [
        dateLabel(d.createdAt),
        d.username,
        d.comment,
        statusNames[d.status],
        "테스트",
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + lines.map((row) => row.map(field).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8;" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "noahflow-test-history.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("테스트 발송 기록을 내보냈어요.");
  }
  const filtered = automations.filter(
    (a) =>
      (filter === "all" || a.status === filter) &&
      `${a.name} ${a.keywords.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const stats = overview?.stats;
  const activeCount = automations.filter((a) => a.status === "active").length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setSection("overview");
          }}
          aria-label="noahflow 대시보드"
        >
          <span className="brand-mark">
            <svg viewBox="0 0 40 40">
              <path d="M9 29V17a6 6 0 0 1 12 0v12M21 24v-7a5 5 0 0 1 10 0v12" />
            </svg>
          </span>
          noahflow<span className="brand-dot">.</span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => setSection("settings")}
        >
          <span className="workspace-avatar">N</span>
          <span>
            <strong>나의 워크스페이스</strong>
            <small>크리에이터 스튜디오</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-section-label">WORKSPACE</div>
        <nav aria-label="주 메뉴">
          {(
            [
              { id: "overview", icon: LayoutDashboard },
              { id: "automations", icon: WandSparkles },
              { id: "posts", icon: FileImage },
              { id: "history", icon: MessageCircle },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${section === item.id ? "selected" : ""}`}
              onClick={() => setSection(item.id)}
            >
              <item.icon size={19} />
              <span>{sectionNames[item.id]}</span>
              {item.id === "automations" && (
                <span className="nav-count">{automations.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-section-label tools-label">TOOLS</div>
        <button
          className={`nav-item ${section === "settings" ? "selected" : ""}`}
          onClick={() => setSection("settings")}
        >
          <Settings2 size={19} />
          <span>계정 및 설정</span>
        </button>
        <button className="nav-item" onClick={() => setGuide(true)}>
          <BookOpen size={19} />
          <span>시작 가이드</span>
          <ArrowUpRight size={14} />
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-spark">
              <Sparkles size={18} />
            </span>
            <h3>작은 댓글, 새로운 연결</h3>
            <p>
              반복하는 안내는 자동화하고
              <br />
              콘텐츠에 더 집중해 보세요.
            </p>
            <button onClick={() => setGuide(true)}>
              활용 방법 알아보기 <ArrowRight size={14} />
            </button>
          </div>
          <button
            className="sidebar-profile"
            onClick={() => setSection("settings")}
          >
            <span className="profile-avatar">N</span>
            <span>
              <strong>나의 크리에이터 계정</strong>
              <small>
                <span className="tiny-dot" />
                테스트 워크스페이스
              </small>
            </span>
            <MoreHorizontal size={19} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>워크스페이스</span>
            <ChevronRight size={13} />
            <strong>{sectionNames[section]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="test-pill">
              <span /> 테스트 모드
            </span>
            <button
              className="icon-button help-top"
              aria-label="도움말"
              onClick={() => setGuide(true)}
            >
              <CircleHelp size={19} />
            </button>
            <button
              className="top-avatar"
              onClick={() => setSection("settings")}
              aria-label="내 계정 설정"
            >
              N
            </button>
          </div>
        </header>
        <main>
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={28} />
              <h2>워크스페이스를 불러오고 있어요</h2>
            </div>
          ) : loadError ? (
            <div className="error-state">
              <h2>워크스페이스에 연결하지 못했어요</h2>
              <p>{loadError}</p>
              <button
                className="primary-button"
                onClick={() => window.location.reload()}
              >
                다시 시도
              </button>
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span /> CONNECT. ENGAGE. GROW.
                  </div>
                  <h1>
                    {section === "automations"
                      ? "댓글이 연결이 되는 순간"
                      : section === "overview"
                        ? "오늘도, 자연스러운 연결"
                        : section === "posts"
                          ? "콘텐츠에서 시작하는 대화"
                          : section === "history"
                            ? "모든 연결의 기록"
                            : "나의 워크스페이스 설정"}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {section === "automations"
                      ? "댓글에 반응하고, 필요한 정보를 DM으로 전해 보세요."
                      : section === "overview"
                        ? "반복되는 안내는 noahflow에게, 더 많은 시간은 콘텐츠에."
                        : section === "posts"
                          ? "게시물과 릴스를 선택해 나만의 자동화를 만들어 보세요."
                          : section === "history"
                            ? "조건 판정부터 DM 전달까지, 테스트 결과를 한눈에 확인하세요."
                            : "실제 계정 연결 전에 테스트 모드로 흐름을 확인해 보세요."}
                  </p>
                </div>
                <div className="heading-actions">
                  {section === "history" ? (
                    <button
                      className="secondary-button"
                      onClick={exportHistory}
                      disabled={!deliveries.length}
                    >
                      <ArrowDownToLine size={16} />
                      기록 내보내기
                    </button>
                  ) : (
                    section !== "settings" && (
                      <button
                        className="primary-button"
                        onClick={() => openCreate()}
                      >
                        <Plus size={18} />
                        자동화 만들기
                      </button>
                    )
                  )}
                </div>
              </div>
              {(section === "automations" || section === "overview") && (
                <>
                  <div className="demo-notice">
                    <div className="notice-icon">
                      <FlaskConical size={18} />
                    </div>
                    <p>
                      <strong>지금은 테스트 워크스페이스예요.</strong>
                      <span>
                        {" "}
                        샘플 콘텐츠로 자동화를 만들어 보세요. 실제 DM은 발송되지
                        않아요.
                      </span>
                    </p>
                    <button onClick={() => setSection("settings")}>
                      계정 연결 안내 <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="stats-grid">
                    {[
                      {
                        label: "활성 자동화",
                        value: stats?.activeAutomations || 0,
                        unit: "개",
                        icon: Zap,
                        color: "purple",
                        sub: `전체 ${stats?.automations || 0}개의 자동화`,
                      },
                      {
                        label: "테스트 DM 발송",
                        value: stats?.sent || 0,
                        unit: "건",
                        icon: Send,
                        color: "blue",
                        sub: "조건을 만족한 테스트 메시지",
                      },
                      {
                        label: "팔로우 확인 대기",
                        value: stats?.pending || 0,
                        unit: "명",
                        icon: Users,
                        color: "amber",
                        sub: "팔로우 확인 후 정보 전달",
                      },
                      {
                        label: "조건 미충족",
                        value: stats?.skipped || 0,
                        unit: "건",
                        icon: ShieldCheck,
                        color: "green",
                        sub: "키워드 및 활성 상태 확인",
                      },
                    ].map((s) => (
                      <div className="stat-card" key={s.label}>
                        <div className="stat-top">
                          <span>{s.label}</span>
                          <span className={`stat-icon ${s.color}`}>
                            <s.icon size={17} />
                          </span>
                        </div>
                        <div className="stat-number">
                          {s.value.toLocaleString()}
                          <span>{s.unit}</span>
                          <span
                            className={`stat-mini-bars ${s.color}`}
                            aria-hidden="true"
                          >
                            {[25, 40, 30, 50, 40, 64, 50, 75, 65].map(
                              (h, i) => (
                                <i key={i} style={{ height: h + "%" }} />
                              ),
                            )}
                          </span>
                        </div>
                        <p>
                          <span className={`stat-dot ${s.color}`} />
                          {s.sub}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {section === "automations" && (
                <div className="automation-layout">
                  <section className="automation-main">
                    <div className="section-heading">
                      <div>
                        <h2>
                          나의 자동화 <span>{automations.length}</span>
                        </h2>
                        <p>콘텐츠별로 설정한 자동화를 관리하세요.</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => openTest()}
                        disabled={!automations.length}
                      >
                        <Play size={14} />
                        자동화 테스트
                      </button>
                    </div>
                    <div className="list-controls">
                      <div className="segmented" aria-label="자동화 상태 필터">
                        {(
                          [
                            { value: "all", label: "전체" },
                            { value: "active", label: "활성" },
                            { value: "paused", label: "일시 중지" },
                          ] as const
                        ).map((f) => (
                          <button
                            key={f.value}
                            className={filter === f.value ? "active" : ""}
                            onClick={() => setFilter(f.value)}
                          >
                            {f.label}
                            {f.value === "all" && (
                              <span>{automations.length}</span>
                            )}
                          </button>
                        ))}
                      </div>
                      <label className="search-field">
                        <Search size={16} />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="자동화 이름, 키워드 검색"
                          aria-label="자동화 검색"
                        />
                      </label>
                    </div>
                    <div className="automation-cards">
                      {filtered.map((a) => (
                        <article className="automation-card" key={a.id}>
                          <div className="automation-card-top">
                            <Media
                              post={posts.find((p) => p.id === a.postId)}
                            />
                            <div className="automation-card-info">
                              <div className="card-state-row">
                                <span className={`state-badge ${a.status}`}>
                                  <span />
                                  {a.status === "active" ? "활성" : "일시 중지"}
                                </span>
                                <button
                                  role="switch"
                                  aria-checked={a.status === "active"}
                                  aria-label={`${a.name} 활성화`}
                                  className={`toggle ${a.status === "active" ? "on" : ""}`}
                                  onClick={() => toggleAutomation(a)}
                                  disabled={pendingAction === a.id}
                                >
                                  <span />
                                </button>
                              </div>
                              <h3>{a.name}</h3>
                              <p>
                                {posts.find((p) => p.id === a.postId)?.title ||
                                  "선택한 콘텐츠"}
                              </p>
                              <div className="keyword-row">
                                {a.triggerType === "all" ? (
                                  <span className="keyword-tag">모든 댓글</span>
                                ) : (
                                  a.keywords.slice(0, 3).map((k) => (
                                    <span className="keyword-tag" key={k}>
                                      #{k}
                                    </span>
                                  ))
                                )}
                                {a.keywords.length > 3 && (
                                  <span className="keyword-more">
                                    +{a.keywords.length - 3}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="automation-flow">
                            <span>
                              <MessageCircle size={13} />
                              댓글 감지
                            </span>
                            <ChevronRight size={11} />
                            {a.requireFollow && (
                              <>
                                <span>
                                  <Users size={13} />
                                  팔로우 확인
                                </span>
                                <ChevronRight size={11} />
                              </>
                            )}
                            <span className="flow-end">
                              <Send size={12} />
                              DM 발송
                            </span>
                          </div>
                          <div className="automation-card-bottom">
                            <span className="card-delivery">
                              <Send size={13} />
                              <strong>{a.counts?.sent || 0}</strong> 테스트 발송
                            </span>
                            <div className="card-actions">
                              <button
                                onClick={() => openTest(a)}
                                title="댓글 테스트"
                                aria-label={`${a.name} 테스트`}
                              >
                                <Play size={14} />
                              </button>
                              <button
                                onClick={() => {
                                  setEditing(a);
                                  setWizard(true);
                                }}
                                title="수정"
                                aria-label={`${a.name} 수정`}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => setDeleting(a)}
                                title="삭제"
                                aria-label={`${a.name} 삭제`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                      <button
                        className="add-automation-card"
                        onClick={() => openCreate()}
                      >
                        <span>
                          <Plus size={22} />
                        </span>
                        <strong>새로운 자동화 만들기</strong>
                        <p>댓글과 DM으로 더 가까워지세요</p>
                      </button>
                    </div>
                    {!filtered.length && automations.length > 0 && (
                      <div className="inline-empty">
                        <Search size={22} />
                        <p>검색 조건에 맞는 자동화가 없어요.</p>
                        <button
                          className="text-button"
                          onClick={() => {
                            setQuery("");
                            setFilter("all");
                          }}
                        >
                          필터 초기화
                        </button>
                      </div>
                    )}
                  </section>
                  <aside className="insights-panel">
                    <div className="journey-card">
                      <div className="journey-label">
                        <Sparkles size={14} /> HOW IT WORKS
                      </div>
                      <h2>
                        댓글 하나가
                        <br />
                        대화의 시작이 되도록
                      </h2>
                      <p>
                        관심을 보인 순간,
                        <br />
                        가장 필요한 정보를 전해요.
                      </p>
                      <div className="journey-visual">
                        <div className="floating-heart">♡</div>
                        <div className="mini-comment">
                          <span className="mini-avatar">J</span>
                          <span>
                            <strong>jiyoon.daily</strong>
                            <small>정보 보내주세요! 🙌</small>
                          </span>
                          <span className="mini-comment-heart">♡</span>
                        </div>
                        <div className="journey-line">
                          <span />
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                        <div className="mini-dm">
                          <span className="mini-dm-icon">
                            <Send size={16} />
                          </span>
                          <div>
                            <strong>요청하신 정보를 보내드려요 💌</strong>
                            <span>링크에서 자세히 확인해 보세요.</span>
                            <div className="mini-link">
                              <Link2 size={11} />
                              자세히 보기 <ExternalLink size={10} />
                            </div>
                          </div>
                          <span className="mini-check">
                            <Check size={11} />
                          </span>
                        </div>
                        <span className="visual-caption">
                          메시지 예시 · 실제 발송되지 않아요
                        </span>
                      </div>
                      <button
                        onClick={() => openTest()}
                        disabled={!automations.length}
                      >
                        내 자동화로 테스트하기 <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="quick-guide">
                      <div className="quick-guide-title">
                        <BookOpen size={17} />
                        <h3>시작이 처음이라면</h3>
                      </div>
                      {[
                        "자동화할 게시물 선택하기",
                        "댓글 키워드와 팔로우 조건 설정",
                        "보낼 메시지와 링크 작성하기",
                      ].map((text, i) => (
                        <button key={text} onClick={() => setGuide(true)}>
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          {text}
                          <ChevronRight size={13} />
                        </button>
                      ))}
                      <div className="guide-foot">
                        <ShieldCheck size={14} />
                        설정은 언제든 수정할 수 있어요.
                      </div>
                    </div>
                  </aside>
                </div>
              )}
              {section === "overview" && (
                <div className="overview-layout">
                  <section className="panel activity-panel">
                    <div className="section-heading">
                      <div>
                        <h2>연결의 흐름</h2>
                        <p>최근 7일 테스트 DM 발송</p>
                      </div>
                      <span className="subtle-label">테스트 데이터</span>
                    </div>
                    <div className="bar-chart">
                      {(overview?.activity || []).map((day) => (
                        <div className="chart-column" key={day.date}>
                          <div className="chart-bars">
                            <span
                              style={{
                                height:
                                  Math.max(
                                    3,
                                    (day.sent * 100) /
                                      Math.max(
                                        1,
                                        ...(overview?.activity || []).map(
                                          (d) => d.sent,
                                        ),
                                      ),
                                  ) + "%",
                              }}
                              title={`${day.sent}건`}
                            />
                          </div>
                          <span>{day.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="chart-legend">
                      <span />
                      테스트 DM 발송
                    </div>
                  </section>
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>최근 활동</h2>
                        <p>새로운 테스트 결과를 확인하세요.</p>
                      </div>
                      <button
                        className="icon-button"
                        onClick={() => setSection("history")}
                        aria-label="발송 기록 보기"
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                    {deliveries.length ? (
                      deliveries.slice(0, 4).map((d) => (
                        <button
                          className="recent-item"
                          key={d.id}
                          onClick={() => setDetail(d)}
                        >
                          <span className={`delivery-icon ${d.status}`}>
                            <Send size={15} />
                          </span>
                          <span>
                            <strong>@{d.username}</strong>
                            <small>{statusNames[d.status]}</small>
                          </span>
                          <time>{dateLabel(d.createdAt)}</time>
                        </button>
                      ))
                    ) : (
                      <EmptyState
                        icon={<Activity size={27} />}
                        title="아직 활동이 없어요"
                        text="첫 댓글 테스트를 실행하면 기록이 나타나요."
                        action={
                          <button
                            className="text-button"
                            onClick={() => openTest()}
                          >
                            첫 테스트 시작하기 <ArrowRight size={14} />
                          </button>
                        }
                      />
                    )}
                  </section>
                  <div className="overview-banner">
                    <span className="overview-banner-icon">
                      <WandSparkles size={25} />
                    </span>
                    <div>
                      <h2>나만의 자동화, 3분이면 충분해요</h2>
                      <p>게시물을 고르고 키워드와 메시지를 설정하면 준비 끝!</p>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => openCreate()}
                    >
                      새 자동화 만들기 <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              )}
              {section === "posts" && (
                <>
                  <div className="content-notice">
                    <Instagram size={17} />
                    <span>
                      샘플 콘텐츠 {posts.length}개 · 실제 계정 연결 전 미리
                      체험해 볼 수 있어요.
                    </span>
                  </div>
                  <div className="posts-grid">
                    {posts.map((post) => (
                      <article className="post-card" key={post.id}>
                        <Media post={post} />
                        <div className="post-card-body">
                          <div className="post-meta">
                            <span>
                              {post.kind === "REEL" ? "릴스" : "게시물"}
                            </span>
                            <span>
                              {new Date(post.publishedAt).toLocaleDateString(
                                "ko-KR",
                                { timeZone: "Asia/Seoul" },
                              )}
                            </span>
                          </div>
                          <h3>{post.title}</h3>
                          <div className="post-bottom">
                            <span>
                              <MessageCircle size={14} />
                              {post.commentCount}
                            </span>
                            <span className="post-automation-count">
                              자동화{" "}
                              {
                                automations.filter((a) => a.postId === post.id)
                                  .length
                              }
                              개
                            </span>
                          </div>
                          <button
                            className="secondary-button"
                            onClick={() => openCreate(post.id)}
                          >
                            <Plus size={14} />
                            자동화 설정하기
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
              {section === "history" && (
                <section className="panel history-panel">
                  <div className="history-controls">
                    <div className="segmented">
                      {[
                        { value: "all", label: "전체" },
                        { value: "sent", label: "테스트 발송" },
                        { value: "pending_follow", label: "확인 대기" },
                        { value: "skipped", label: "조건 미충족" },
                      ].map((f) => (
                        <button
                          key={f.value}
                          className={historyFilter === f.value ? "active" : ""}
                          onClick={() => setHistoryFilter(f.value)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <span className="subtle-label">
                      실제 DM은 발송되지 않았어요
                    </span>
                  </div>
                  {deliveries.filter(
                    (d) =>
                      historyFilter === "all" || d.status === historyFilter,
                  ).length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>참여자</th>
                            <th>댓글 내용</th>
                            <th>자동화</th>
                            <th>처리 상태</th>
                            <th>시간</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {deliveries
                            .filter(
                              (d) =>
                                historyFilter === "all" ||
                                d.status === historyFilter,
                            )
                            .map((d) => (
                              <tr key={d.id}>
                                <td>
                                  <span className="table-user-avatar">
                                    {d.username[0]?.toUpperCase()}
                                  </span>
                                  <strong>@{d.username}</strong>
                                </td>
                                <td className="comment-cell">{d.comment}</td>
                                <td>
                                  {automations.find(
                                    (a) => a.id === d.automationId,
                                  )?.name || "삭제된 자동화"}
                                </td>
                                <td>
                                  <span
                                    className={`delivery-badge ${d.status}`}
                                  >
                                    {statusNames[d.status]}
                                  </span>
                                </td>
                                <td className="date-cell">
                                  {dateLabel(d.createdAt)}
                                </td>
                                <td>
                                  <button
                                    className="icon-button"
                                    onClick={() => setDetail(d)}
                                    aria-label={`${d.username} 발송 상세`}
                                  >
                                    <ChevronRight size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState
                      icon={<MessageCircle size={30} />}
                      title="아직 발송 기록이 없어요"
                      text="댓글 테스트를 실행하면 조건 판정과 발송 결과가 여기에 기록돼요."
                      action={
                        <button
                          className="primary-button"
                          onClick={() => openTest()}
                          disabled={!automations.length}
                        >
                          <Play size={15} />
                          댓글 테스트하기
                        </button>
                      }
                    />
                  )}
                </section>
              )}
              {section === "settings" && (
                <div className="settings-layout">
                  <section className="panel account-panel">
                    <div className="section-heading">
                      <div>
                        <h2>인스타그램 계정</h2>
                        <p>테스트를 마친 뒤 실제 연동을 준비하세요.</p>
                      </div>
                      <Instagram size={24} />
                    </div>
                    <div className="connection-status">
                      <span className="connection-instagram">
                        <Instagram size={30} />
                      </span>
                      <div>
                        <h3>아직 연결된 계정이 없어요</h3>
                        <p>현재 모든 자동화는 테스트 모드에서만 실행돼요.</p>
                      </div>
                      <span className="neutral-badge">미연결</span>
                    </div>
                    <div className="integration-info">
                      <ShieldCheck size={18} />
                      <p>
                        실제 발송에는 인스타그램 전문 계정과 승인된 API 권한이
                        필요해요. 계정 비밀번호나 API 키를 이 화면에 입력하지
                        마세요.
                      </p>
                    </div>
                    <InstagramConnectionPanel />
                    <h3 className="settings-subheading">
                      실제 연동 전 확인할 사항
                    </h3>
                    <ol className="connection-steps">
                      <li>
                        <span>1</span>
                        <div>
                          <strong>전문 계정과 API 연결 준비</strong>
                          <p>
                            Meta 또는 Socian의 승인된 연결 방식과 권한을
                            확인해요.
                          </p>
                        </div>
                      </li>
                      <li>
                        <span>2</span>
                        <div>
                          <strong>댓글 이벤트와 DM 발송 조건 확인</strong>
                          <p>
                            웹훅 수신, 발송 가능 기간, 이미지·링크 지원 범위를
                            확인해요.
                          </p>
                        </div>
                      </li>
                      <li>
                        <span>3</span>
                        <div>
                          <strong>팔로우 확인 지원 여부 검증</strong>
                          <p>
                            팔로우 상태를 조회할 수 있는 경우에만 조건부 발송을
                            활성화해요.
                          </p>
                        </div>
                      </li>
                    </ol>
                    <div className="settings-footnote">
                      <Clock3 size={15} />
                      실제 API 연동은 아직 구성되지 않았어요. 테스트 데이터는 이
                      기기에 저장돼요.
                    </div>
                  </section>
                  <section className="panel">
                    <div className="settings-icon">
                      <FlaskConical size={23} />
                    </div>
                    <h2>연결 전에도 충분히 테스트</h2>
                    <p className="settings-description">
                      자동화 규칙과 메시지를 미리 만들고,
                      <br />
                      팔로우 여부에 따른 흐름을 확인해 보세요.
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => openTest()}
                      disabled={!automations.length}
                    >
                      <Play size={15} />
                      테스트 모드 실행
                    </button>
                    <div className="settings-divider" />
                    <h3 className="settings-subheading">
                      지원되는 테스트 기능
                    </h3>
                    <ul className="feature-checklist">
                      {[
                        "게시물 · 릴스별 자동화",
                        "여러 댓글 키워드 매칭",
                        "팔로우 조건과 확인 대기",
                        "텍스트 · 이미지 · 링크 구성",
                        "중복 이벤트 발송 방지",
                      ].map((item) => (
                        <li key={item}>
                          <CheckCircle2 size={15} />
                          {item}
                        </li>
                      ))}
                    </ul>
                    <p className="unsupported-note">
                      새 팔로워에게 댓글 없이 보내는 DM은 현재 지원하지 않아요.
                    </p>
                  </section>
                </div>
              )}
              <footer className="page-footer">
                <span>
                  © {new Date().getFullYear()} noahflow. Made for meaningful
                  connections.
                </span>
                <span>
                  <span className="tiny-dot" />
                  {activeCount}개의 자동화 활성 · 테스트 모드
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {wizard && (
        <AutomationWizard
          posts={posts}
          initial={editing}
          initialPostId={initialPostId}
          onClose={() => setWizard(false)}
          onSave={saveAutomation}
        />
      )}
      {testing && (
        <Dialog
          title="내 자동화 테스트하기"
          description="직접 댓글을 입력하고 DM이 전달되는 흐름을 확인해 보세요."
          onClose={() => {
            if (!testBusy) setTesting(false);
          }}
          wide
        >
          <div className="test-layout">
            <form className="test-form" onSubmit={runTest}>
              <label>
                테스트할 자동화
                <select
                  value={testAutomationId}
                  onChange={(e) => {
                    setTestAutomationId(e.target.value);
                    setTestResult(null);
                  }}
                  required
                >
                  <option value="" disabled>
                    자동화를 선택하세요
                  </option>
                  {automations.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.status === "paused" ? " (일시 중지)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                참여자 이름
                <div className="input-with-prefix">
                  <span>@</span>
                  <input
                    value={testUsername}
                    onChange={(e) => setTestUsername(e.target.value)}
                    required
                    maxLength={50}
                    placeholder="noah_friend"
                  />
                </div>
              </label>
              <label>
                작성한 댓글
                <textarea
                  value={testComment}
                  onChange={(e) => setTestComment(e.target.value)}
                  required
                  maxLength={2000}
                  rows={3}
                  placeholder="설정한 키워드를 포함해 보세요"
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={testFollows}
                  onChange={(e) => setTestFollows(e.target.checked)}
                />
                <span>
                  참여자가 이미 팔로우하고 있어요
                  <small>
                    확인 답장 이후의 팔로우 상태를 가정한 테스트예요.
                  </small>
                </span>
              </label>
              {testError && (
                <p role="alert" className="form-error">
                  {testError}
                </p>
              )}
              <button
                className="primary-button full-width"
                type="submit"
                disabled={testBusy || !testAutomationId}
              >
                {testBusy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Play size={15} />
                )}
                댓글 입력 테스트
              </button>
              <p className="test-disclaimer">
                <FlaskConical size={13} />
                인스타그램에 댓글이나 DM을 보내지 않아요.
              </p>
            </form>
            <div className="test-preview">
              {testResult ? (
                <>
                  <span className={`delivery-badge ${testResult.status}`}>
                    {statusNames[testResult.status]}
                  </span>
                  <h3>
                    {testResult.status === "sent"
                      ? "메시지가 준비되었어요 💌"
                      : testResult.status === "pending_follow"
                        ? "팔로우 확인을 기다려요"
                        : "발송 조건과 일치하지 않아요"}
                  </h3>
                  <p className="test-reason">{testResult.reason}</p>
                  {testResult.status !== "skipped" && (
                    <div className="result-dm">
                      <div className="result-dm-heading">
                        <span className="brand-mark small">
                          <Send size={15} />
                        </span>
                        <strong>noahflow</strong>
                        <span>테스트 미리보기</span>
                      </div>
                      <div className="result-bubble">
                        {testResult.status === "pending_follow"
                          ? testResult.nonFollowerMessage ||
                            "팔로우 후 확인해 주세요."
                          : testResult.message?.text}
                        {testResult.status === "sent" &&
                          testResult.message?.imageUrl && (
                            <img
                              src={testResult.message.imageUrl}
                              alt="DM에 포함한 이미지"
                            />
                          )}
                      </div>
                      {testResult.status === "sent" &&
                        testResult.message?.links?.map((l, i) => (
                          <a
                            className="preview-link-button"
                            key={i}
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {l.label}
                            <ExternalLink size={12} />
                          </a>
                        ))}
                    </div>
                  )}
                  {testResult.reply && (
                    <div className="test-public-reply">
                      <span>
                        <MessageCircle size={13} />
                        자동 댓글 답글 미리보기
                      </span>
                      <p>{testResult.reply}</p>
                    </div>
                  )}
                  {testResult.status === "pending_follow" && (
                    <button
                      className="secondary-button full-width"
                      onClick={() => verifyFollow(testResult)}
                      disabled={testBusy}
                    >
                      <Users size={15} />
                      확인 답장·팔로우 조회 테스트
                    </button>
                  )}
                </>
              ) : (
                <div className="test-empty">
                  <span>
                    <Send size={29} />
                  </span>
                  <h3>어떤 메시지를 받게 될까요?</h3>
                  <p>
                    왼쪽에서 댓글을 입력하면
                    <br />
                    자동화 결과를 여기서 확인할 수 있어요.
                  </p>
                  <div className="test-path">
                    <MessageCircle size={16} />
                    <ChevronRight size={12} />
                    <Users size={16} />
                    <ChevronRight size={12} />
                    <Send size={16} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {deleting && (
        <Dialog
          title="자동화를 삭제할까요?"
          description={`‘${deleting.name}’의 설정이 삭제돼요. 기존 테스트 기록은 보관됩니다.`}
          onClose={() => {
            if (!pendingAction) setDeleting(null);
          }}
        >
          <div className="dialog-buttons">
            <button
              className="secondary-button"
              onClick={() => setDeleting(null)}
              disabled={!!pendingAction}
            >
              취소
            </button>
            <button
              className="danger-button"
              onClick={deleteAutomation}
              disabled={!!pendingAction}
            >
              {pendingAction ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Trash2 size={15} />
              )}
              삭제하기
            </button>
          </div>
        </Dialog>
      )}
      {detail && (
        <Dialog
          title="발송 기록 상세"
          description={`${dateLabel(detail.createdAt)} · @${detail.username}`}
          onClose={() => setDetail(null)}
        >
          <div className="detail-content">
            <span className={`delivery-badge ${detail.status}`}>
              {statusNames[detail.status]}
            </span>
            <dl>
              <dt>댓글</dt>
              <dd>{detail.comment}</dd>
              <dt>처리 결과</dt>
              <dd>{detail.reason}</dd>
              <dt>
                {detail.status === "pending_follow" ? "팔로우 안내" : "DM 내용"}
              </dt>
              <dd className="detail-message">
                {(detail.status === "pending_follow"
                  ? detail.nonFollowerMessage
                  : detail.message?.text) ||
                  "이 조건에서는 정보 DM이 발송되지 않았어요."}
              </dd>
              {detail.reply && (
                <>
                  <dt>자동 댓글 답글</dt>
                  <dd>{detail.reply}</dd>
                </>
              )}
            </dl>
            {detail.status === "pending_follow" && (
              <button
                className="primary-button"
                onClick={() => verifyFollow(detail)}
                disabled={testBusy}
              >
                <Users size={15} />
                확인 답장·팔로우 조회 테스트
              </button>
            )}
            <p className="test-disclaimer">
              테스트 기록이며 실제 메시지는 전송되지 않았어요.
            </p>
          </div>
        </Dialog>
      )}
      {guide && (
        <Dialog
          title="댓글에서 DM까지, 세 단계면 끝"
          description="작은 반응을 의미 있는 연결로 바꾸세요."
          onClose={() => setGuide(false)}
        >
          <div className="guide-modal-steps">
            {[
              {
                icon: FileImage,
                title: "콘텐츠를 선택해요",
                text: "자동화할 게시물이나 릴스를 골라 주세요. 한 콘텐츠에 여러 키워드 자동화를 설정할 수 있어요.",
              },
              {
                icon: MousePointer2,
                title: "반응할 조건을 정해요",
                text: "모든 댓글 또는 지정 키워드를 선택하세요. 팔로우 조건을 켜면 확인 전까지 정보 DM은 대기해요.",
              },
              {
                icon: Send,
                title: "필요한 정보를 전해요",
                text: "텍스트, 이미지 주소, 링크 버튼을 구성해요. 저장 후 댓글 테스트로 결과를 확인해 보세요.",
              },
            ].map((step, i) => (
              <div key={step.title}>
                <span>
                  <step.icon size={21} />
                </span>
                <div>
                  <small>STEP 0{i + 1}</small>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </div>
            ))}
          </div>
          <button
            className="primary-button full-width"
            onClick={() => {
              setGuide(false);
              openCreate();
            }}
          >
            <Plus size={16} />첫 자동화 만들기
          </button>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="알림 닫기">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
