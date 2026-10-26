import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Instagram,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import "./InstagramConnectionPanel.css";

type Readiness = {
  configured: boolean;
  status: string;
  missing: string[];
  invalid: unknown[];
  liveSendingEnabled: false;
};
type Probe = {
  ok: boolean;
  error?: { code: string; message: string };
  subscriptions?: {
    appCount: number;
    fields: string[];
    hasComments: boolean;
    hasMessages: boolean;
  };
  liveSendingEnabled: false;
};

export default function InstagramConnectionPanel() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [result, setResult] = useState<Probe | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    fetch("/api/instagram/status")
      .then(async (response) => {
        if (!response.ok)
          throw new Error("연동 준비 상태를 불러오지 못했어요.");
        const data = await response.json();
        if (mounted) setReadiness(data);
      })
      .catch((cause) => {
        if (mounted) setError(cause.message);
      });
    return () => {
      mounted = false;
    };
  }, []);
  async function probe() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/instagram/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json();
      if (data.error && !data.readiness)
        throw new Error(data.error.message || "조회하지 못했어요.");
      setResult(data);
      if (data.readiness) setReadiness(data.readiness);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "조회하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ig-panel" aria-label="Instagram API 준비 확인">
      <div className="ig-panel-heading">
        <span>
          <Instagram size={21} />
        </span>
        <div>
          <h3>실제 계정 연결 준비</h3>
          <p>Instagram 로그인 방식 · 서버에서만 토큰 사용</p>
        </div>
        <span className="ig-state">
          {readiness?.configured ? "설정 있음 · 미검증" : "설정 필요"}
        </span>
      </div>
      <p className="ig-description">
        Meta 앱의 구독 정보를 읽기 전용으로 조회해요. 이 버튼은 댓글이나 DM을
        보내지 않아요.
      </p>
      {readiness?.missing.length ? (
        <div className="ig-missing">
          <strong>서버에 필요한 설정</strong>
          <ul>
            {readiness.missing.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <p>
            Codespaces 비밀 설정에서 추가한 뒤 환경을 다시 시작하세요. 토큰을
            채팅이나 이 화면에 입력하지 마세요.
          </p>
        </div>
      ) : null}
      {!!readiness?.invalid.length && (
        <p className="ig-error" role="alert">
          서버 설정 형식이 맞지 않아요. 실행 안내의 변수 이름과 API 버전을
          확인해 주세요.
        </p>
      )}
      <div className="ig-actions">
        <button
          className="secondary-button"
          onClick={probe}
          disabled={busy || !readiness?.configured}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <ShieldCheck size={15} />
          )}
          읽기 전용 구독 확인
        </button>
        <a
          href="https://github.com/codenoah123-prog/noahbrain/blob/codex/browser-test/docs/INSTAGRAM-READINESS.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          연동 준비 안내 <ExternalLink size={12} />
        </a>
      </div>
      {(error || result?.error) && (
        <p className="ig-error" role="alert">
          {error || result?.error?.message}
        </p>
      )}
      {result?.ok && (
        <div className="ig-result">
          <strong>
            <CheckCircle2 size={15} />
            구독 정보를 조회했어요
          </strong>
          <p>
            댓글 구독: {result.subscriptions?.hasComments ? "등록됨" : "미등록"}{" "}
            · 메시지 구독:{" "}
            {result.subscriptions?.hasMessages ? "등록됨" : "미등록"}
          </p>
          <small>
            실제 댓글 수신, DM 발송, 팔로우 조회는 각각 추가 검증이 필요해요.
          </small>
        </div>
      )}
      <div className="ig-consent">
        <strong>팔로우 조건의 실제 진행 순서</strong>
        <p>
          키워드 댓글 → 안내 DM 1회 → 상대의 ‘확인’ 답장 → 팔로우 조회 → 자료
          발송
        </p>
        <small>
          댓글만으로 프로필 조회 동의가 생기지는 않아요. 현재 자동화와 메시지
          작성 화면은 계속 테스트 모드로 동작해요.
        </small>
      </div>
    </section>
  );
}
