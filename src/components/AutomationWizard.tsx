import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  Image as ImageIcon,
  Instagram,
  Link2,
  MessageCircle,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "./AutomationWizard.css";

export type Post = {
  id: string;
  title: string;
  thumbnail: string;
  kind: "REEL" | "POST";
  publishedAt: string;
  commentCount: number;
};

export type AutomationInput = {
  name: string;
  postId: string;
  triggerType: "keywords" | "all";
  keywords: string[];
  requireFollow: boolean;
  replyEnabled: boolean;
  replyText: string;
  message: {
    text: string;
    imageUrl: string;
    links: { label: string; url: string }[];
  };
  nonFollowerMessage: string;
};

export type Automation = AutomationInput & {
  id: string;
  status: "active" | "paused";
  createdAt: string;
};

type Props = {
  posts: Post[];
  initial?: Automation | null;
  initialPostId?: string;
  onClose: () => void;
  onSave: (payload: AutomationInput) => Promise<void>;
};

const steps = ["게시물 선택", "자동화 조건", "메시지 작성"];
const defaultMessage =
  "안녕하세요, {{username}}님! ✨\n요청하신 정보를 보내드려요. 아래 링크를 확인해 주세요.";
const defaultFollowMessage =
  "자료를 받으려면 계정을 팔로우한 뒤 이 DM에 ‘확인’이라고 답장해 주세요 💙";

function isWebUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export default function AutomationWizard({
  posts,
  initial,
  initialPostId,
  onClose,
  onSave,
}: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<AutomationInput>(() =>
    initial
      ? {
          name: initial.name,
          postId: initial.postId,
          triggerType: initial.triggerType,
          keywords: [...initial.keywords],
          requireFollow: initial.requireFollow,
          replyEnabled: initial.replyEnabled,
          replyText: initial.replyText,
          message: {
            ...initial.message,
            links: initial.message.links.map((link) => ({ ...link })),
          },
          nonFollowerMessage: initial.nonFollowerMessage,
        }
      : {
          name: initialPostId
            ? `${posts.find((post) => post.id === initialPostId)?.title.slice(0, 30) || "새 게시물"} · DM 자동화`
            : "",
          postId: initialPostId || "",
          triggerType: "keywords",
          keywords: ["정보"],
          requireFollow: false,
          replyEnabled: true,
          replyText: "DM으로 안내해 드렸어요 💙 메시지를 확인해 주세요!",
          message: { text: defaultMessage, imageUrl: "", links: [] },
          nonFollowerMessage: defaultFollowMessage,
        },
  );
  const [keywordInput, setKeywordInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [messageTab, setMessageTab] = useState<"text" | "image">("text");
  const [previewFollower, setPreviewFollower] = useState(true);
  const selectedPost = posts.find((post) => post.id === draft.postId);
  const previewText = (
    draft.requireFollow && !previewFollower
      ? draft.nonFollowerMessage
      : draft.message.text
  ).replace(/\{\{\s*username\s*\}\}/g, "민지");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const elements = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
      );
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, saving]);

  function patch(values: Partial<AutomationInput>) {
    setDraft((old) => ({ ...old, ...values }));
    setError("");
  }
  function patchMessage(values: Partial<AutomationInput["message"]>) {
    setDraft((old) => ({ ...old, message: { ...old.message, ...values } }));
    setError("");
  }

  function addKeyword() {
    const additions = keywordInput
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!additions.length) return;
    if (additions.some((value) => value.length > 40)) {
      setError("키워드는 하나당 40자까지 입력해 주세요.");
      return;
    }
    const next = [...new Set([...draft.keywords, ...additions])];
    if (next.length > 10) {
      setError("키워드는 최대 10개까지 설정할 수 있어요.");
      return;
    }
    patch({ keywords: next });
    setKeywordInput("");
  }

  function validate(current: number) {
    if (current === 0 && !posts.some((post) => post.id === draft.postId))
      return "자동화를 연결할 게시물 또는 릴스를 선택해 주세요.";
    if (current === 1) {
      if (!draft.name.trim())
        return "목록에서 알아볼 수 있는 자동화 이름을 입력해 주세요.";
      if (draft.triggerType === "keywords" && !draft.keywords.length)
        return "댓글에 포함될 키워드를 하나 이상 추가해 주세요.";
      if (draft.triggerType === "keywords" && keywordInput.trim())
        return "입력한 키워드 옆의 추가 버튼을 눌러 주세요.";
      if (draft.replyEnabled && !draft.replyText.trim())
        return "자동 답글 내용을 입력하거나 답글 기능을 꺼 주세요.";
    }
    if (current === 2) {
      if (
        !draft.message.text.trim() &&
        !draft.message.imageUrl.trim() &&
        !draft.message.links.length
      )
        return "보낼 메시지, 이미지 또는 링크를 추가해 주세요.";
      if (
        draft.message.imageUrl.trim() &&
        !isWebUrl(draft.message.imageUrl.trim())
      )
        return "로그인 정보가 없는 https:// 또는 http:// 이미지 주소를 입력해 주세요.";
      if (
        draft.message.links.some(
          (link) => !link.label.trim() || !isWebUrl(link.url.trim()),
        )
      )
        return "링크 버튼의 이름과 로그인 정보가 없는 올바른 웹 주소를 입력해 주세요.";
      if (draft.requireFollow && !draft.nonFollowerMessage.trim())
        return "아직 팔로우하지 않은 분에게 보낼 안내를 입력해 주세요.";
    }
    return "";
  }

  function next() {
    const issue = validate(step);
    if (issue) {
      setError(issue);
      return;
    }
    setError("");
    setStep((value) => value + 1);
  }

  async function save() {
    for (let current = 0; current < 3; current++) {
      const issue = validate(current);
      if (issue) {
        setStep(current);
        setError(issue);
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        keywords: draft.keywords.map((keyword) => keyword.trim()),
        replyText: draft.replyText.trim(),
        nonFollowerMessage: draft.nonFollowerMessage.trim(),
        message: {
          text: draft.message.text.trim(),
          imageUrl: draft.message.imageUrl.trim(),
          links: draft.message.links.map((link) => ({
            label: link.label.trim(),
            url: link.url.trim(),
          })),
        },
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="wiz-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="wiz-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <header className="wiz-header">
          <div className="wiz-header-brand">
            <span className="wiz-brand-icon">
              <Sparkles size={19} />
            </span>
            <div>
              <h2 id={titleId}>
                {initial ? "자동화 수정하기" : "새 자동화 만들기"}
              </h2>
              <p>작은 댓글을, 새로운 연결로.</p>
            </div>
          </div>
          <button
            ref={closeRef}
            className="wiz-icon-button"
            aria-label="자동화 설정 닫기"
            disabled={saving}
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>

        <div className="wiz-stepper" aria-label={`설정 단계 ${step + 1} / 3`}>
          {steps.map((label, index) => (
            <div
              key={label}
              className={`wiz-step ${index === step ? "wiz-current" : ""} ${index < step ? "wiz-complete" : ""}`}
              aria-current={index === step ? "step" : undefined}
            >
              <span className="wiz-step-circle">
                {index < step ? <Check size={14} /> : `0${index + 1}`}
              </span>
              <span>{label}</span>
              {index < 2 && <span className="wiz-step-line" />}
            </div>
          ))}
        </div>

        <div className="wiz-layout">
          <main className="wiz-content">
            <div className="wiz-heading">
              <span className="wiz-eyebrow">STEP 0{step + 1}</span>
              <h3>
                {
                  [
                    "어떤 게시물에 연결할까요?",
                    "어떤 댓글에 반응할까요?",
                    "마음을 전할 메시지를 써 주세요.",
                  ][step]
                }
              </h3>
              <p>
                {
                  [
                    "나의 게시물과 릴스 중 자동화를 시작할 콘텐츠를 선택해 주세요.",
                    "키워드와 팔로우 조건으로 꼭 필요한 분께 메시지를 보내세요.",
                    "유용한 정보와 링크를 담아, 댓글 다음의 대화를 시작하세요.",
                  ][step]
                }
              </p>
            </div>

            {step === 0 && (
              <div className="wiz-post-step">
                <div className="wiz-source-row">
                  <span>
                    <Instagram size={16} /> 기존 게시물에서 선택
                  </span>
                  <span className="wiz-count">{posts.length}개 콘텐츠</span>
                </div>
                <div className="wiz-post-grid">
                  {posts.map((post) => (
                    <button
                      type="button"
                      key={post.id}
                      className={`wiz-post ${draft.postId === post.id ? "wiz-selected" : ""}`}
                      onClick={() =>
                        patch({
                          postId: post.id,
                          ...(!draft.name
                            ? { name: `${post.title.slice(0, 30)} · DM 자동화` }
                            : {}),
                        })
                      }
                      aria-pressed={draft.postId === post.id}
                    >
                      <div className="wiz-post-image">
                        <img src={post.thumbnail} alt="" />
                        <span className="wiz-post-kind">
                          {post.kind === "REEL" ? (
                            <Clapperboard size={12} />
                          ) : (
                            <ImageIcon size={12} />
                          )}
                          {post.kind === "REEL" ? "릴스" : "게시물"}
                        </span>
                        <span className="wiz-post-check">
                          {draft.postId === post.id && <Check size={15} />}
                        </span>
                      </div>
                      <div className="wiz-post-details">
                        <strong>{post.title}</strong>
                        <span>
                          <MessageCircle size={12} />{" "}
                          {post.commentCount.toLocaleString("ko-KR")}
                          <i />
                          {new Date(post.publishedAt).toLocaleDateString(
                            "ko-KR",
                            {
                              month: "short",
                              day: "numeric",
                              timeZone: "Asia/Seoul",
                            },
                          )}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {!posts.length && (
                  <div className="wiz-empty">
                    선택할 게시물이 없어요. 게시물 목록을 새로 불러온 뒤 시도해
                    주세요.
                  </div>
                )}
                <div className="wiz-future-note">
                  <div className="wiz-future-icon">
                    <Plus size={17} />
                  </div>
                  <div>
                    <strong>다음 게시물에도 자동으로 연결하고 싶다면?</strong>
                    <p>
                      새 게시물 감지는 인스타그램 계정 연결 후 이용할 수 있어요.
                    </p>
                  </div>
                  <span>연결 필요</span>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="wiz-form">
                <label className="wiz-field">
                  <span>
                    자동화 이름 <b>*</b>
                  </span>
                  <input
                    value={draft.name}
                    maxLength={100}
                    placeholder="예: 봄맞이 가이드북 무료 나눔"
                    onChange={(event) => patch({ name: event.target.value })}
                  />
                  <small>자동화 목록에 표시되는 이름이에요.</small>
                </label>
                <fieldset className="wiz-fieldset">
                  <legend>댓글 조건</legend>
                  <div className="wiz-choice-row">
                    <button
                      className={`wiz-choice ${draft.triggerType === "keywords" ? "wiz-choice-active" : ""}`}
                      onClick={() => patch({ triggerType: "keywords" })}
                      aria-pressed={draft.triggerType === "keywords"}
                    >
                      <span className="wiz-radio" />
                      <div>
                        <strong>특정 키워드가 있을 때</strong>
                        <small>관심을 표현한 분께 정확하게</small>
                      </div>
                    </button>
                    <button
                      className={`wiz-choice ${draft.triggerType === "all" ? "wiz-choice-active" : ""}`}
                      onClick={() => patch({ triggerType: "all" })}
                      aria-pressed={draft.triggerType === "all"}
                    >
                      <span className="wiz-radio" />
                      <div>
                        <strong>모든 댓글에</strong>
                        <small>댓글을 남긴 모든 분께</small>
                      </div>
                    </button>
                  </div>
                </fieldset>
                {draft.triggerType === "keywords" && (
                  <div className="wiz-keyword-box">
                    <label htmlFor={`${titleId}-keyword`}>
                      감지할 키워드 <span>{draft.keywords.length}/10</span>
                    </label>
                    <div className="wiz-input-action">
                      <input
                        id={`${titleId}-keyword`}
                        value={keywordInput}
                        maxLength={400}
                        onChange={(event) =>
                          setKeywordInput(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === ",") {
                            event.preventDefault();
                            addKeyword();
                          }
                        }}
                        placeholder="예: 정보, 링크, 가이드"
                      />
                      <button
                        onClick={addKeyword}
                        disabled={!keywordInput.trim()}
                      >
                        <Plus size={15} /> 추가
                      </button>
                    </div>
                    <div className="wiz-keywords">
                      {draft.keywords.map((keyword) => (
                        <span key={keyword}>
                          {keyword}
                          <button
                            aria-label={`${keyword} 키워드 삭제`}
                            onClick={() =>
                              patch({
                                keywords: draft.keywords.filter(
                                  (value) => value !== keyword,
                                ),
                              })
                            }
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <p>
                      하나라도 포함되면 작동해요. 영문 대소문자는 구분하지
                      않아요.
                    </p>
                  </div>
                )}

                <section className="wiz-option">
                  <div className="wiz-option-head">
                    <span className="wiz-option-icon">
                      <Users size={18} />
                    </span>
                    <div>
                      <strong>팔로워에게만 정보 보내기</strong>
                      <p>확인 답장 이후 팔로우 여부를 조회해 발송해요.</p>
                    </div>
                    <button
                      className={`wiz-toggle ${draft.requireFollow ? "wiz-toggle-on" : ""}`}
                      role="switch"
                      aria-label="팔로워 조건 사용"
                      aria-checked={draft.requireFollow}
                      onClick={() => {
                        patch({ requireFollow: !draft.requireFollow });
                        setPreviewFollower(true);
                      }}
                    >
                      <span />
                    </button>
                  </div>
                  {draft.requireFollow && (
                    <div className="wiz-option-info">
                      <ShieldCheck size={14} />
                      <span>
                        실제 연동에서는 안내 DM을 먼저 보내고, 상대의 답장 뒤에
                        팔로우 상태를 조회해요. 현재는 이 흐름을 가정한
                        테스트예요.
                      </span>
                    </div>
                  )}
                </section>
                <section className="wiz-option">
                  <div className="wiz-option-head">
                    <span className="wiz-option-icon wiz-green">
                      <MessageCircle size={18} />
                    </span>
                    <div>
                      <strong>댓글에도 답글 남기기</strong>
                      <p>DM을 보냈다는 안내로 대화를 자연스럽게 이어요.</p>
                    </div>
                    <button
                      className={`wiz-toggle ${draft.replyEnabled ? "wiz-toggle-on" : ""}`}
                      role="switch"
                      aria-label="자동 댓글 답글 사용"
                      aria-checked={draft.replyEnabled}
                      onClick={() =>
                        patch({ replyEnabled: !draft.replyEnabled })
                      }
                    >
                      <span />
                    </button>
                  </div>
                  {draft.replyEnabled && (
                    <label className="wiz-subfield">
                      <span>자동 답글 내용</span>
                      <textarea
                        rows={2}
                        value={draft.replyText}
                        maxLength={1000}
                        onChange={(event) =>
                          patch({ replyText: event.target.value })
                        }
                        placeholder="DM을 확인해 주세요 💙"
                      />
                    </label>
                  )}
                </section>
              </div>
            )}

            {step === 2 && (
              <div className="wiz-form">
                <div
                  className="wiz-message-tabs"
                  role="tablist"
                  aria-label="메시지 구성"
                >
                  <button
                    role="tab"
                    aria-selected={messageTab === "text"}
                    className={messageTab === "text" ? "wiz-tab-active" : ""}
                    onClick={() => setMessageTab("text")}
                  >
                    <MessageCircle size={15} /> 메시지
                  </button>
                  <button
                    role="tab"
                    aria-selected={messageTab === "image"}
                    className={messageTab === "image" ? "wiz-tab-active" : ""}
                    onClick={() => setMessageTab("image")}
                  >
                    <ImageIcon size={15} /> 이미지{" "}
                    {draft.message.imageUrl && <span className="wiz-tab-dot" />}
                  </button>
                </div>
                {messageTab === "text" ? (
                  <label className="wiz-field">
                    <span>보낼 DM 내용</span>
                    <textarea
                      rows={6}
                      value={draft.message.text}
                      maxLength={
                        import.meta.env.MODE === "cloudflare" ? 1000 : 2000
                      }
                      onChange={(event) =>
                        patchMessage({ text: event.target.value })
                      }
                      placeholder="안녕하세요! 요청하신 자료를 보내드려요."
                    />
                    <div className="wiz-field-bottom">
                      <small>
                        <Sparkles size={12} /> {"{{username}}"}을 넣으면 상대방
                        이름으로 바뀌어요.
                      </small>
                      <span>
                        {draft.message.text.length}/
                        {import.meta.env.MODE === "cloudflare"
                          ? "1,000"
                          : "2,000"}
                      </span>
                    </div>
                  </label>
                ) : (
                  <div className="wiz-image-editor">
                    <label className="wiz-field">
                      <span>이미지 주소</span>
                      <input
                        type="url"
                        value={draft.message.imageUrl}
                        maxLength={2048}
                        onChange={(event) =>
                          patchMessage({ imageUrl: event.target.value })
                        }
                        placeholder="https://example.com/guide.jpg"
                      />
                      <small>
                        공개적으로 접근 가능한 이미지 URL을 입력해 주세요.
                      </small>
                    </label>
                    {draft.message.imageUrl &&
                    isWebUrl(draft.message.imageUrl) ? (
                      <div className="wiz-image-preview">
                        <img
                          src={draft.message.imageUrl}
                          alt="DM으로 보낼 이미지 미리보기"
                        />
                        <button
                          className="wiz-icon-button"
                          onClick={() => patchMessage({ imageUrl: "" })}
                          aria-label="메시지 이미지 삭제"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="wiz-image-placeholder">
                        <ImageIcon size={26} />
                        <strong>이미지로 더 생생하게</strong>
                        <span>
                          가이드 표지, 쿠폰, 상품 사진을 추가해 보세요.
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="wiz-links">
                  <div className="wiz-section-label">
                    <span>
                      링크 버튼 <em>선택</em>
                    </span>
                    <small>{draft.message.links.length}/3</small>
                  </div>
                  {draft.message.links.map((link, index) => (
                    <div className="wiz-link-row" key={index}>
                      <div className="wiz-link-number">
                        <Link2 size={15} />
                      </div>
                      <div>
                        <input
                          aria-label={`링크 ${index + 1} 버튼 이름`}
                          value={link.label}
                          maxLength={
                            import.meta.env.MODE === "cloudflare" ? 20 : 80
                          }
                          placeholder="버튼 이름 · 예: 자료 받기"
                          onChange={(event) =>
                            patchMessage({
                              links: draft.message.links.map((value, i) =>
                                i === index
                                  ? { ...value, label: event.target.value }
                                  : value,
                              ),
                            })
                          }
                        />
                        <input
                          aria-label={`링크 ${index + 1} 주소`}
                          type="url"
                          value={link.url}
                          maxLength={2048}
                          placeholder="https://"
                          onChange={(event) =>
                            patchMessage({
                              links: draft.message.links.map((value, i) =>
                                i === index
                                  ? { ...value, url: event.target.value }
                                  : value,
                              ),
                            })
                          }
                        />
                      </div>
                      <button
                        className="wiz-icon-button"
                        onClick={() =>
                          patchMessage({
                            links: draft.message.links.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                        aria-label={`링크 ${index + 1} 삭제`}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  {draft.message.links.length < 3 && (
                    <button
                      className="wiz-add-link"
                      onClick={() =>
                        patchMessage({
                          links: [
                            ...draft.message.links,
                            { label: "", url: "" },
                          ],
                        })
                      }
                    >
                      <Plus size={16} /> 링크 버튼 추가
                    </button>
                  )}
                </div>

                {draft.requireFollow && (
                  <label className="wiz-field wiz-follower-field">
                    <span>
                      <Users size={15} /> 확인 답장을 요청하는 첫 안내
                    </span>
                    <textarea
                      rows={3}
                      value={draft.nonFollowerMessage}
                      maxLength={1000}
                      onChange={(event) =>
                        patch({ nonFollowerMessage: event.target.value })
                      }
                    />
                    <small>
                      실제 연동의 첫 DM은 1회 안내로 시작하며, 답장 뒤 팔로우
                      여부를 조회해요.
                    </small>
                  </label>
                )}
                <div className="wiz-demo-note">
                  <ShieldCheck size={17} />
                  <div>
                    <strong>안심하고 먼저 테스트해 보세요.</strong>
                    <p>
                      지금은 테스트 모드예요. 저장 후 댓글 시뮬레이터로 확인할
                      수 있으며 실제 DM은 발송되지 않아요.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </main>

          <aside className="wiz-preview-pane">
            <div className="wiz-preview-title">
              <span>메시지 미리보기</span>
              <span className="wiz-preview-live">
                <i /> 실시간 반영
              </span>
            </div>
            {draft.requireFollow && (
              <div className="wiz-preview-switch">
                <button
                  className={previewFollower ? "wiz-preview-active" : ""}
                  onClick={() => setPreviewFollower(true)}
                >
                  팔로워
                </button>
                <button
                  className={!previewFollower ? "wiz-preview-active" : ""}
                  onClick={() => setPreviewFollower(false)}
                >
                  미팔로워
                </button>
              </div>
            )}
            <div className="wiz-phone">
              <div className="wiz-phone-status">
                <span>9:41</span>
                <div className="wiz-phone-island" />
                <span>••• ▰</span>
              </div>
              <div className="wiz-phone-header">
                <ArrowLeft size={18} />
                <span className="wiz-phone-avatar">
                  <Sparkles size={16} />
                </span>
                <div>
                  <strong>
                    noah.studio <ChevronDown size={11} />
                  </strong>
                  <small>크리에이터</small>
                </div>
                <Instagram size={19} />
              </div>
              <div className="wiz-phone-body">
                <div className="wiz-phone-time">오늘 오후 2:30</div>
                {selectedPost && (
                  <div className="wiz-shared-post">
                    <img src={selectedPost.thumbnail} alt="선택한 게시물" />
                    <div>
                      <span>
                        {selectedPost.kind === "REEL"
                          ? "릴스에 댓글을 남겼어요"
                          : "게시물에 댓글을 남겼어요"}
                      </span>
                      <strong>
                        {draft.triggerType === "all"
                          ? "좋은 정보 감사해요! 💙"
                          : `${draft.keywords[0] || "정보"} 부탁드려요!`}
                      </strong>
                    </div>
                  </div>
                )}
                <div className="wiz-chat-row">
                  <span className="wiz-chat-avatar">
                    <Sparkles size={12} />
                  </span>
                  <div className="wiz-bubble-stack">
                    <div className="wiz-chat-bubble">
                      {previewText || "작성한 메시지가 여기에 표시돼요 ✨"}
                    </div>
                    {(!draft.requireFollow || previewFollower) &&
                      draft.message.imageUrl &&
                      isWebUrl(draft.message.imageUrl) && (
                        <img
                          className="wiz-chat-image"
                          src={draft.message.imageUrl}
                          alt="메시지 이미지"
                        />
                      )}
                    {(!draft.requireFollow || previewFollower) &&
                      draft.message.links.map((link, index) => (
                        <div className="wiz-chat-link" key={index}>
                          <Link2 size={13} />
                          {link.label || "링크 버튼"}
                        </div>
                      ))}
                    {draft.requireFollow && !previewFollower && (
                      <div className="wiz-chat-link">
                        <Check size={14} /> ‘확인’ 답장 후 팔로우 조회
                      </div>
                    )}
                    <small className="wiz-chat-status">
                      미리보기 · 실제 발송되지 않아요
                    </small>
                  </div>
                </div>
              </div>
              <div className="wiz-phone-compose">
                <span>메시지 보내기...</span>
                <ImageIcon size={16} />
                <Send size={16} />
              </div>
            </div>
            <p className="wiz-preview-caption">
              댓글 하나에서 시작되는
              <br />
              <strong>우리의 다음 대화.</strong>
            </p>
          </aside>
        </div>

        <footer className="wiz-footer">
          <div className="wiz-footer-status">
            {error ? (
              <p className="wiz-error" role="alert">
                {error}
              </p>
            ) : (
              <span>
                <ShieldCheck size={14} /> 설정은 언제든 수정할 수 있어요.
              </span>
            )}
          </div>
          <div className="wiz-footer-actions">
            <button
              className="wiz-back"
              disabled={saving}
              onClick={() => {
                if (step === 0) onClose();
                else {
                  setStep((value) => value - 1);
                  setError("");
                }
              }}
            >
              {step === 0 ? (
                "취소"
              ) : (
                <>
                  <ArrowLeft size={15} /> 이전
                </>
              )}
            </button>
            {step < 2 ? (
              <button className="wiz-primary" onClick={next}>
                다음 단계 <ArrowRight size={16} />
              </button>
            ) : (
              <button className="wiz-primary" disabled={saving} onClick={save}>
                {saving ? (
                  "저장하는 중..."
                ) : (
                  <>
                    <Check size={16} />{" "}
                    {initial ? "변경사항 저장" : "자동화 만들기"}
                  </>
                )}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
