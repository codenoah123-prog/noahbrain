import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Instagram,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import App from "./App";
import { hostedHeaders, setHostedCsrf } from "./hosted-auth";
import "./hosted.css";

type Session = { configured: boolean; authenticated: boolean; csrf?: string };
type Setup = {
  appId?: string;
  apiVersion?: string;
  connected: boolean;
  account?: { id: string; username?: string };
  webhookVerified: boolean;
  subscribed: boolean;
  enabled: boolean;
  webhookUrl: string;
  verifyToken: string;
  hasCredentials: boolean;
  mode: "demo" | "live";
  lastWebhookAt?: string;
};
type Phase = "loading" | "locked" | "login" | "authenticated";
type Busy =
  | ""
  | "login"
  | "connect"
  | "refresh"
  | "subscribe"
  | "enable"
  | "logout"
  | "disconnect";

const instructions =
  "https://github.com/codenoah123-prog/noahbrain/blob/cloudflare-web/docs/CLOUDFLARE-START.md";

class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...hostedHeaders() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(
      "서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.",
      response.status,
    );
  }
  if (!response.ok)
    throw new RequestError(
      data.error?.message || "요청을 처리하지 못했어요.",
      response.status,
    );
  return data;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`hosted-brand ${compact ? "hosted-brand-compact" : ""}`}>
      <span>
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <path d="M9 29V17a6 6 0 0 1 12 0v12M21 24v-7a5 5 0 0 1 10 0v12" />
        </svg>
      </span>
      noahflow<span className="hosted-brand-dot">.</span>
    </span>
  );
}

function StepStatus({
  complete,
  children,
}: {
  complete: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`hosted-check-row ${complete ? "hosted-checked" : ""}`}>
      {complete ? (
        <CheckCircle2 size={16} />
      ) : (
        <span className="hosted-empty-check" />
      )}
      {children}
    </span>
  );
}

function CopyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("복사했어요");
    } catch {
      setStatus("입력란을 선택해 직접 복사해 주세요.");
    }
    setTimeout(() => setStatus(""), 3000);
  }
  return (
    <label className="hosted-copy-field">
      <span>{label}</span>
      <div>
        <input
          type={secret && !revealed ? "password" : "text"}
          readOnly
          value={value || ""}
          onFocus={(event) => event.currentTarget.select()}
          aria-label={label}
        />
        {secret && (
          <button
            type="button"
            className="hosted-icon-button"
            onClick={() => setRevealed((old) => !old)}
            aria-label={revealed ? `${label} 숨기기` : `${label} 표시`}
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
        <button
          type="button"
          className="hosted-copy-button"
          onClick={copy}
          disabled={!value}
        >
          <Copy size={14} />
          복사
        </button>
      </div>
      <small role="status">{status || "\u00a0"}</small>
    </label>
  );
}

export default function HostedApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<Busy>("");
  const [showSetup, setShowSetup] = useState(true);
  const [stage, setStage] = useState(0);
  const [editingConnection, setEditingConnection] = useState(false);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [apiVersion, setApiVersion] = useState("v24.0");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [appKey, setAppKey] = useState(0);

  function updateSetup(data: Setup) {
    setSetup(data);
    setAppId(data.appId || "");
    setAccountId(data.account?.id || "");
    setApiVersion(data.apiVersion || "v24.0");
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const session = await request<Session>("/session");
        if (!mounted) return;
        if (!session.configured) {
          setPhase("locked");
          return;
        }
        if (!session.authenticated) {
          setHostedCsrf(null);
          setPhase("login");
          return;
        }
        setHostedCsrf(session.csrf);
        const data = await request<Setup>("/setup");
        if (!mounted) return;
        updateSetup(data);
        setShowSetup(
          !data.connected || !data.webhookVerified || !data.subscribed,
        );
        setStage(
          !data.connected
            ? 0
            : !data.webhookVerified || !data.subscribed
              ? 1
              : 2,
        );
        setPhase("authenticated");
      } catch (cause) {
        if (mounted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "사이트에 연결하지 못했어요.",
          );
          setPhase("login");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function failure(cause: unknown) {
    if (cause instanceof RequestError && cause.status === 401) {
      setHostedCsrf(null);
      setPhase("login");
      setSetup(null);
      setPassword("");
      setAppSecret("");
      setAccessToken("");
      setError(
        "로그인이 만료됐어요. 사이트 관리자 비밀번호로 다시 로그인해 주세요.",
      );
      return;
    }
    setError(
      cause instanceof Error ? cause.message : "요청을 처리하지 못했어요.",
    );
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy("login");
    setError("");
    try {
      const result = await request<{ ok: true; csrf: string }>("/login", {
        password,
      });
      setHostedCsrf(result.csrf);
      setPassword("");
      const data = await request<Setup>("/setup");
      updateSetup(data);
      setShowSetup(
        !data.connected || !data.webhookVerified || !data.subscribed,
      );
      setStage(
        !data.connected ? 0 : !data.webhookVerified || !data.subscribed ? 1 : 2,
      );
      setPhase("authenticated");
    } catch (cause) {
      failure(cause);
    } finally {
      setPassword("");
      setBusy("");
    }
  }

  async function logout() {
    setBusy("logout");
    setError("");
    try {
      await request("/logout", {});
      setHostedCsrf(null);
      setSetup(null);
      setAppSecret("");
      setAccessToken("");
      setPhase("login");
    } catch (cause) {
      failure(cause);
    } finally {
      setBusy("");
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy("connect");
    setError("");
    setNotice("");
    try {
      await request("/setup", {
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        accountId: accountId.trim(),
        accessToken: accessToken.trim(),
        apiVersion: apiVersion.trim(),
      });
      const data = await request<Setup>("/setup");
      updateSetup(data);
      setStage(1);
      setEditingConnection(false);
      setAppKey((old) => old + 1);
      setNotice("계정 정보를 조회했어요. 다음은 댓글과 DM 수신 연결입니다.");
    } catch (cause) {
      failure(cause);
    } finally {
      setAppSecret("");
      setAccessToken("");
      setBusy("");
    }
  }

  async function refresh() {
    setBusy("refresh");
    setError("");
    setNotice("");
    try {
      const data = await request<Setup>("/setup");
      updateSetup(data);
      setNotice(
        data.webhookVerified
          ? "Meta의 웹훅 주소 검증이 확인됐어요."
          : "아직 Meta의 주소 검증이 확인되지 않았어요. 아래 두 항목을 Meta 앱에 등록해 주세요.",
      );
    } catch (cause) {
      failure(cause);
    } finally {
      setBusy("");
    }
  }

  async function subscribe() {
    setBusy("subscribe");
    setError("");
    setNotice("");
    try {
      await request("/setup/subscribe", {});
      const data = await request<Setup>("/setup");
      updateSetup(data);
      if (data.webhookVerified && data.subscribed) setStage(2);
      setNotice(
        "댓글·메시지 이벤트 구독을 확인했어요. 실제 수신은 테스트 게시물에서 확인해 주세요.",
      );
    } catch (cause) {
      failure(cause);
    } finally {
      setBusy("");
    }
  }

  async function setEnabled(enabled: boolean) {
    setBusy("enable");
    setError("");
    setNotice("");
    try {
      await request("/setup/enable", {
        enabled,
        acknowledged: enabled && acknowledged,
      });
      const data = await request<Setup>("/setup");
      updateSetup(data);
      setAppKey((old) => old + 1);
      if (enabled) {
        setShowSetup(false);
        setNotice(
          "자동 발송을 켰어요. 먼저 본인의 테스트 게시물에서 확인해 주세요.",
        );
      } else setNotice("실제 자동 발송을 껐어요.");
      setAcknowledged(false);
    } catch (cause) {
      failure(cause);
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    setNotice("");
    try {
      await request("/setup/disconnect", {});
      const data = await request<Setup>("/setup");
      updateSetup(data);
      setStage(0);
      setShowSetup(true);
      setEditingConnection(false);
      setConfirmDisconnect(false);
      setAcknowledged(false);
      setAppKey((old) => old + 1);
      setNotice("계정 연결을 해제하고 실제 발송을 껐어요.");
    } catch (cause) {
      failure(cause);
    } finally {
      setAppSecret("");
      setAccessToken("");
      setBusy("");
    }
  }

  if (phase === "loading")
    return (
      <div className="hosted-loading">
        <Brand />
        <LoaderCircle size={27} className="spin" />
        <p>나의 워크스페이스를 확인하고 있어요.</p>
      </div>
    );

  if (phase === "locked")
    return (
      <div className="hosted-auth-page">
        <div className="hosted-auth-card">
          <Brand />
          <span className="hosted-auth-icon">
            <LockKeyhole size={26} />
          </span>
          <h1>사이트 설정을 마무리해 주세요</h1>
          <p>
            Cloudflare에 관리자 비밀번호 설정이 아직 없거나 실행에 필요한 설정이
            준비되지 않았어요.
          </p>
          <ol className="hosted-locked-steps">
            <li>Cloudflare에서 이 Worker를 엽니다.</li>
            <li>
              설정의 비밀 변수에 <code>ADMIN_PASSWORD</code>를 추가합니다.
            </li>
            <li>
              서로 다른 문자를 섞은 20자 이상 비밀번호를 정하고 이 화면을
              새로고침합니다.
            </li>
          </ol>
          <button
            className="hosted-primary"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={16} />
            설정 후 다시 확인
          </button>
          <a
            className="hosted-doc-link"
            href={instructions}
            target="_blank"
            rel="noopener noreferrer"
          >
            처음 설정 안내 열기 <ExternalLink size={13} />
          </a>
          <p className="hosted-security-note">
            <ShieldCheck size={14} />
            인스타그램 비밀번호를 여기에 설정하는 것이 아닙니다.
          </p>
        </div>
      </div>
    );

  if (phase === "login")
    return (
      <div className="hosted-auth-page">
        <div className="hosted-auth-decoration" aria-hidden="true">
          <span className="hosted-orbit hosted-orbit-one" />
          <span className="hosted-orbit hosted-orbit-two" />
          <span className="hosted-decoration-icon">
            <MessageCircle size={30} />
          </span>
          <span className="hosted-decoration-small">
            <Sparkles size={20} />
          </span>
        </div>
        <div className="hosted-auth-card">
          <Brand />
          <div className="hosted-auth-eyebrow">YOUR PRIVATE WORKSPACE</div>
          <h1>
            댓글에서 시작되는
            <br />
            나만의 연결<span>.</span>
          </h1>
          <p>
            사이트 관리자 비밀번호로 로그인하세요.
            <br />
            설치 없이, 이 웹주소에서 관리할 수 있어요.
          </p>
          <form onSubmit={login} className="hosted-login-form">
            <label htmlFor="hosted-password">사이트 관리자 비밀번호</label>
            <div className="hosted-password-input">
              <LockKeyhole size={17} />
              <input
                id="hosted-password"
                type={passwordVisible ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                maxLength={512}
                placeholder="Cloudflare 배포 때 정한 비밀번호"
                disabled={!!busy}
              />
              <button
                type="button"
                onClick={() => setPasswordVisible((old) => !old)}
                aria-label={
                  passwordVisible ? "비밀번호 숨기기" : "비밀번호 표시"
                }
              >
                {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {error && (
              <p className="hosted-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="hosted-primary"
              disabled={!!busy || !password}
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <ArrowRight size={17} />
              )}
              내 워크스페이스 열기
            </button>
          </form>
          <p className="hosted-security-note">
            <ShieldCheck size={14} />
            인스타그램 계정의 비밀번호가 아닙니다.
          </p>
          <a
            className="hosted-doc-link"
            href={instructions}
            target="_blank"
            rel="noopener noreferrer"
          >
            비밀번호를 처음 설정하시나요? <ExternalLink size={12} />
          </a>
        </div>
        <div className="hosted-auth-foot">noahflow · 개인용 댓글·DM 자동화</div>
      </div>
    );

  const webhookReady = !!setup?.webhookVerified && !!setup?.subscribed;
  const canEnable = !!setup?.connected && webhookReady && acknowledged;
  const metaDashboard = setup?.appId
    ? `https://developers.facebook.com/apps/${encodeURIComponent(setup.appId)}/`
    : "https://developers.facebook.com/apps/";

  return (
    <div className={`hosted-root ${!showSetup ? "hosted-dashboard" : ""}`}>
      <header className="hosted-topbar">
        <Brand compact />
        <div className="hosted-topbar-state">
          <span className={setup?.enabled ? "hosted-live-dot" : ""} />
          <span className="hosted-account-name">
            {setup?.connected
              ? `@${setup.account?.username || "연결된 계정"}`
              : "계정 연결 준비"}
          </span>
          <span
            className={`hosted-status-pill ${setup?.enabled ? "hosted-status-on" : ""}`}
          >
            {setup?.enabled ? "실제 발송 켜짐" : "실제 발송 꺼짐"}
          </span>
        </div>
        <div className="hosted-topbar-actions">
          <button
            onClick={() => {
              setShowSetup((old) => !old);
              setError("");
              setNotice("");
            }}
            disabled={!!busy}
          >
            <Settings2 size={15} />
            {showSetup ? "자동화 화면" : "계정 설정"}
          </button>
          <button onClick={logout} disabled={!!busy} aria-label="로그아웃">
            <LogOut size={15} />
            <span>로그아웃</span>
          </button>
        </div>
      </header>
      {notice && !showSetup && (
        <div className="hosted-dashboard-notice" role="status">
          <CheckCircle2 size={16} />
          {notice}
          <button onClick={() => setNotice("")} aria-label="알림 닫기">
            ×
          </button>
        </div>
      )}
      {error && !showSetup && (
        <div className="hosted-dashboard-error" role="alert">
          {error}
        </div>
      )}
      {!showSetup && setup ? (
        <App
          key={appKey}
          hostedRuntime={{
            connected: setup.connected,
            enabled: setup.enabled,
            username: setup.account?.username,
            mode: setup.connected ? setup.mode : "demo",
          }}
        />
      ) : (
        <main className="hosted-setup-main">
          <div className="hosted-setup-heading">
            <div className="hosted-auth-eyebrow">
              <span />
              ONE-TIME SETUP
            </div>
            <h1>
              처음 한 번만 연결해 주세요<span>.</span>
            </h1>
            <p>
              이미 만들어 두신 Meta 앱을 연결하면, 다음부터는 이 웹주소에서
              자동화를 관리할 수 있어요.
            </p>
          </div>
          <div className="hosted-step-navigation" aria-label="계정 연결 단계">
            {[
              { title: "계정 연결", complete: !!setup?.connected },
              { title: "댓글·DM 받기", complete: webhookReady },
              { title: "자동화 켜기", complete: !!setup?.enabled },
            ].map((step, index) => (
              <button
                key={step.title}
                onClick={() => {
                  setStage(index);
                  setError("");
                  setNotice("");
                }}
                aria-current={stage === index ? "step" : undefined}
                disabled={!!busy || (index > 0 && !setup?.connected)}
                className={`${stage === index ? "hosted-step-current" : ""} ${step.complete ? "hosted-step-complete" : ""}`}
              >
                <span>
                  {step.complete ? <Check size={15} /> : `0${index + 1}`}
                </span>
                {step.title}
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
          {error && (
            <div className="hosted-error hosted-page-message" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="hosted-success hosted-page-message" role="status">
              <CheckCircle2 size={17} />
              {notice}
            </div>
          )}
          <div className="hosted-setup-layout">
            <section className="hosted-setup-card">
              {stage === 0 && (
                <>
                  <div className="hosted-card-title">
                    <span>
                      <Instagram size={23} />
                    </span>
                    <div>
                      <small>STEP 01</small>
                      <h2>내 인스타그램 계정 연결</h2>
                    </div>
                  </div>
                  <p className="hosted-card-intro">
                    Meta 앱에서 확인한 값을 이 사이트의 보안 화면에 한 번 등록해
                    주세요. 인스타그램 로그인 비밀번호는 입력하지 않습니다.
                  </p>
                  {setup?.connected && !editingConnection ? (
                    <div className="hosted-account-connected">
                      <span>
                        <CheckCircle2 size={25} />
                      </span>
                      <h3>@{setup.account?.username || "연결된 계정"}</h3>
                      <p>
                        계정의 읽기 정보를 확인한 상태예요.
                        <br />
                        실제 수신·발송은 다음 단계에서 확인합니다.
                      </p>
                      <button
                        className="hosted-primary"
                        onClick={() => setStage(1)}
                      >
                        다음: 댓글·DM 받기 <ArrowRight size={16} />
                      </button>
                      <button
                        className="hosted-text-button"
                        onClick={() => setEditingConnection(true)}
                      >
                        토큰 또는 연결 정보 다시 등록
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={connect} className="hosted-connection-form">
                      <div className="hosted-form-row">
                        <label>
                          <span>Meta 앱 ID</span>
                          <input
                            aria-label="Meta 앱 ID"
                            value={appId}
                            onChange={(event) => setAppId(event.target.value)}
                            inputMode="numeric"
                            pattern="[0-9]+"
                            maxLength={40}
                            required
                            autoComplete="off"
                            placeholder="Meta 앱의 숫자 ID"
                            disabled={!!busy}
                          />
                          <small>Meta 앱의 기본 설정에서 확인해요.</small>
                        </label>
                        <label>
                          <span>Instagram 계정 ID</span>
                          <input
                            aria-label="Instagram 계정 ID"
                            value={accountId}
                            onChange={(event) =>
                              setAccountId(event.target.value)
                            }
                            inputMode="numeric"
                            pattern="[0-9]+"
                            maxLength={40}
                            required
                            autoComplete="off"
                            placeholder="전문 계정의 숫자 ID"
                            disabled={!!busy}
                          />
                          <small>@사용자명과는 다른 숫자 ID예요.</small>
                        </label>
                      </div>
                      <label>
                        <span>Meta 앱 비밀값</span>
                        <input
                          type="password"
                          aria-label="Meta 앱 비밀값"
                          value={appSecret}
                          onChange={(event) => setAppSecret(event.target.value)}
                          maxLength={512}
                          required
                          autoComplete="new-password"
                          placeholder="앱 기본 설정의 App secret"
                          disabled={!!busy}
                        />
                      </label>
                      <label>
                        <span>Instagram 액세스 토큰</span>
                        <input
                          type="password"
                          aria-label="Instagram 액세스 토큰"
                          value={accessToken}
                          onChange={(event) =>
                            setAccessToken(event.target.value)
                          }
                          maxLength={8192}
                          required
                          autoComplete="new-password"
                          placeholder="Instagram 로그인 방식으로 발급한 토큰"
                          disabled={!!busy}
                        />
                        <small>
                          Meta 앱의 Instagram API 설정에서 발급해요. 만료되면 새
                          토큰을 등록해야 할 수 있어요.
                        </small>
                      </label>
                      <details className="hosted-advanced">
                        <summary>
                          API 버전 확인 <ChevronDown size={14} />
                        </summary>
                        <label>
                          <span>Meta 앱에서 지원하는 API 버전</span>
                          <input
                            aria-label="Meta 앱에서 지원하는 API 버전"
                            value={apiVersion}
                            onChange={(event) =>
                              setApiVersion(event.target.value)
                            }
                            pattern="v[0-9]+\.[0-9]+"
                            maxLength={12}
                            required
                            disabled={!!busy}
                          />
                          <small>
                            v24.0은 문서 예제 기본값이며 최신 버전이라는 뜻은
                            아닙니다. 사용 앱에서 지원하는 값을 확인해 주세요.
                          </small>
                        </label>
                      </details>
                      <div className="hosted-form-security">
                        <ShieldCheck size={16} />
                        <p>
                          비밀값과 토큰은 서버에서 암호화해 보관해요. 채팅이나
                          GitHub 파일로 보내지 마세요. 이 확인 버튼은 DM을
                          보내지 않습니다.
                        </p>
                      </div>
                      <div className="hosted-form-actions">
                        {editingConnection && (
                          <button
                            type="button"
                            className="hosted-secondary"
                            onClick={() => {
                              setEditingConnection(false);
                              setAppSecret("");
                              setAccessToken("");
                            }}
                          >
                            취소
                          </button>
                        )}
                        <button
                          type="submit"
                          className="hosted-primary"
                          disabled={!!busy}
                        >
                          {busy === "connect" ? (
                            <LoaderCircle size={16} className="spin" />
                          ) : (
                            <Link2 size={16} />
                          )}
                          계정 연결 확인
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
              {stage === 1 && (
                <>
                  <div className="hosted-card-title">
                    <span>
                      <MessageCircle size={23} />
                    </span>
                    <div>
                      <small>STEP 02</small>
                      <h2>댓글과 DM을 받을 주소 등록</h2>
                    </div>
                  </div>
                  <p className="hosted-card-intro">
                    아래 두 항목을 Meta 앱의 웹훅 설정에 복사해 주세요. 처음 한
                    번만 등록하면 됩니다.
                  </p>
                  <a
                    className="hosted-provider-button"
                    href={metaDashboard}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Instagram size={17} />내 Meta 앱 설정 열기{" "}
                    <ExternalLink size={14} />
                  </a>
                  <div className="hosted-provider-help">
                    <strong>Meta 앱에서 할 일</strong>
                    <ol>
                      <li>Instagram의 웹훅 설정을 엽니다.</li>
                      <li>
                        콜백 URL과 확인 토큰에 아래 값을 붙여 넣고 검증합니다.
                      </li>
                      <li>
                        이벤트 항목 <code>comments</code>와{" "}
                        <code>messages</code>를 설정합니다.
                      </li>
                    </ol>
                  </div>
                  <CopyField label="콜백 URL" value={setup?.webhookUrl || ""} />
                  <CopyField
                    label="확인 토큰 (Verify token)"
                    value={setup?.verifyToken || ""}
                    secret
                  />
                  <div className="hosted-checks">
                    <StepStatus complete={!!setup?.webhookVerified}>
                      Meta에서 이 주소를 검증했어요
                    </StepStatus>
                    <StepStatus complete={!!setup?.subscribed}>
                      댓글·메시지 이벤트가 구독됐어요
                    </StepStatus>
                  </div>
                  <div className="hosted-form-actions hosted-wrap-actions">
                    <button
                      className="hosted-secondary"
                      onClick={refresh}
                      disabled={!!busy}
                    >
                      {busy === "refresh" ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                      등록 상태 새로고침
                    </button>
                    <button
                      className="hosted-primary"
                      onClick={subscribe}
                      disabled={
                        !!busy || !setup?.connected || !setup?.webhookVerified
                      }
                    >
                      {busy === "subscribe" ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Link2 size={16} />
                      )}
                      댓글·DM 수신 연결
                    </button>
                  </div>
                  {!setup?.webhookVerified && (
                    <p className="hosted-inline-help">
                      Meta에서 주소 검증을 마친 후 새로고침하면 수신 연결 버튼을
                      사용할 수 있어요.
                    </p>
                  )}
                  {webhookReady && (
                    <button
                      className="hosted-next-button"
                      onClick={() => setStage(2)}
                    >
                      다음: 자동화 켜기 <ArrowRight size={16} />
                    </button>
                  )}
                </>
              )}
              {stage === 2 && (
                <>
                  <div className="hosted-card-title">
                    <span>
                      <Zap size={23} />
                    </span>
                    <div>
                      <small>STEP 03</small>
                      <h2>준비되면 자동화를 켜 주세요</h2>
                    </div>
                  </div>
                  <p className="hosted-card-intro">
                    게시물과 메시지를 먼저 설정하고, 실제 발송을 켜 주세요. 켠
                    뒤에는 본인의 테스트 게시물에서 첫 동작을 확인하는 것을
                    권합니다.
                  </p>
                  <div className="hosted-readiness-list">
                    <StepStatus complete={!!setup?.connected}>
                      Instagram 계정 정보 확인
                    </StepStatus>
                    <StepStatus complete={!!setup?.webhookVerified}>
                      Meta 웹훅 주소 검증
                    </StepStatus>
                    <StepStatus complete={!!setup?.subscribed}>
                      댓글·DM 이벤트 구독
                    </StepStatus>
                  </div>
                  <button
                    className="hosted-provider-button"
                    onClick={() => setShowSetup(false)}
                  >
                    <Settings2 size={17} />
                    게시물·키워드·메시지 설정하기 <ArrowRight size={15} />
                  </button>
                  <div className="hosted-live-explanation">
                    <strong>팔로우 조건이 있으면 이렇게 진행돼요</strong>
                    <div>
                      <span>키워드 댓글</span>
                      <ArrowRight size={12} />
                      <span>안내 DM 1회</span>
                      <ArrowRight size={12} />
                      <span>‘확인’ 답장</span>
                      <ArrowRight size={12} />
                      <span>팔로우 조회</span>
                      <ArrowRight size={12} />
                      <span>자료 전달</span>
                    </div>
                    <p>
                      팔로우 상태가 확인되지 않거나 응답 가능 시간이 지나면
                      자료를 보내지 않아요. 계정·권한에 따른 실제 수신과 발송
                      가능 여부는 첫 테스트에서 확인해야 합니다.
                    </p>
                  </div>
                  {setup?.enabled ? (
                    <div className="hosted-enabled-card">
                      <CheckCircle2 size={24} />
                      <div>
                        <strong>실제 자동 발송이 켜져 있어요</strong>
                        <p>활성화한 규칙에 맞는 댓글에 반응합니다.</p>
                      </div>
                      <button
                        className="hosted-secondary"
                        onClick={() => setEnabled(false)}
                        disabled={!!busy}
                      >
                        {busy === "enable" ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : null}
                        발송 끄기
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="hosted-live-consent">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(event) =>
                            setAcknowledged(event.target.checked)
                          }
                          disabled={!!busy}
                        />
                        <span>
                          설정한 게시물의 댓글 참여자에게 실제 메시지를 보내는
                          데 동의합니다.
                        </span>
                      </label>
                      <button
                        className="hosted-primary hosted-live-button"
                        onClick={() => setEnabled(true)}
                        disabled={!!busy || !canEnable}
                      >
                        {busy === "enable" ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <Zap size={17} />
                        )}
                        실제 자동 발송 켜기
                      </button>
                      {!webhookReady && (
                        <p className="hosted-inline-help">
                          이전 단계의 주소 검증과 수신 연결을 먼저 완료해
                          주세요.
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
            <aside className="hosted-help-card">
              <span className="hosted-help-icon">
                <Sparkles size={22} />
              </span>
              <h2>
                설정은 한 번,
                <br />
                관리는 웹에서.
              </h2>
              <p>
                프로그램을 내려받거나
                <br />
                컴퓨터를 계속 켜둘 필요 없이
                <br />이 사이트에서 관리해요.
              </p>
              <div className="hosted-help-divider" />
              <h3>기억해 주세요</h3>
              <ul>
                <li>
                  <LockKeyhole size={15} />이 사이트는 관리자 비밀번호로
                  보호돼요.
                </li>
                <li>
                  <ShieldCheck size={15} />
                  인스타그램 비밀번호는 입력하지 않아요.
                </li>
                <li>
                  <Users size={15} />
                  팔로우 확인은 상대의 답장 뒤에 진행해요.
                </li>
              </ul>
              <a href={instructions} target="_blank" rel="noopener noreferrer">
                단계별 연결 안내 <ExternalLink size={12} />
              </a>
              {!setup?.connected && (
                <button
                  className="hosted-demo-link"
                  onClick={() => {
                    setShowSetup(false);
                    setNotice(
                      "샘플 콘텐츠를 사용하는 체험 화면이에요. 실제 메시지는 보내지 않습니다.",
                    );
                  }}
                >
                  먼저 화면 체험하기 <ArrowRight size={13} />
                </button>
              )}
            </aside>
          </div>
          {setup?.connected && (
            <div className="hosted-disconnect">
              {confirmDisconnect ? (
                <>
                  <span>
                    계정 연결을 해제하고 실제 발송을 끌까요? 자동화와 기록은
                    남습니다.
                  </span>
                  <button onClick={disconnect} disabled={!!busy}>
                    {busy === "disconnect" ? "해제 중…" : "연결 해제하기"}
                  </button>
                  <button
                    onClick={() => setConfirmDisconnect(false)}
                    disabled={!!busy}
                  >
                    취소
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmDisconnect(true)}
                  disabled={!!busy}
                >
                  계정 연결 해제
                </button>
              )}
            </div>
          )}
          <footer className="hosted-setup-footer">
            <ShieldCheck size={13} />
            <span>
              무료 서비스 한도 안에서 운영하는 개인용 구성입니다. 계정 권한과
              서비스 한도는 별도로 적용됩니다.
            </span>
          </footer>
        </main>
      )}
    </div>
  );
}
