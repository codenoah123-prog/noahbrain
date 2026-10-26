"""Run the built demo in an isolated database; requires Python Playwright + Chromium."""
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
if not (ROOT / "dist/index.html").exists():
    raise SystemExit("Run npm run build first.")
with tempfile.TemporaryDirectory(prefix="noahflow-browser-") as temp:
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    environment = dict(os.environ, PORT=str(port), HOST="127.0.0.1", DB_PATH=str(Path(temp) / "test.sqlite"))
    server = subprocess.Popen(["node", "server/index.mjs"], cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for attempt in range(50):
            try:
                with urllib.request.urlopen(origin + "/api/health", timeout=1) as response:
                    assert response.status == 200
                break
            except OSError:
                if server.poll() is not None:
                    raise RuntimeError(server.stderr.read().decode())
                time.sleep(0.1)
        else:
            raise RuntimeError("Demo server did not become healthy")
        with sync_playwright() as playwright:
            chromium = shutil.which("chromium") or shutil.which("google-chrome")
            browser = playwright.chromium.launch(**({"executable_path": chromium} if chromium else {}), headless=True, args=["--no-sandbox"])
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(origin, wait_until="networkidle")
            expect(page.locator(".automation-card")).to_have_count(2)
            assert page.locator(".automation-card img").evaluate_all("imgs => imgs.length === 2 && imgs.every(i => i.complete && i.naturalWidth > 0)")
            page.get_by_role("button", name="자동화 만들기", exact=True).click()
            dialog = page.get_by_role("dialog")
            dialog.locator(".wiz-post").first.click()
            dialog.get_by_role("button", name="다음 단계").click()
            dialog.get_by_label("자동화 이름", exact=False).fill("브라우저 검증 자동화")
            dialog.get_by_role("switch", name="팔로워 조건 사용").click()
            dialog.get_by_role("button", name="다음 단계").click()
            dialog.get_by_role("button", name="링크 버튼 추가").click()
            dialog.get_by_label("링크 1 버튼 이름").fill("자료 받아보기")
            dialog.get_by_label("링크 1 주소").fill("https://example.com/guide")
            dialog.get_by_role("button", name="자동화 만들기", exact=True).click()
            expect(dialog).not_to_be_visible()
            card = page.locator(".automation-card").filter(has_text="브라우저 검증 자동화")
            card.get_by_role("button", name="브라우저 검증 자동화 테스트").click()
            test = page.get_by_role("dialog")
            username = test.get_by_role("textbox", name="참여자 이름")
            username.fill("qa_friend")
            username.press("End")
            username.press_sequentially("_ok", delay=15)
            expect(username).to_have_value("qa_friend_ok")
            test.get_by_role("textbox", name="작성한 댓글").fill("정보 보내주세요")
            test.get_by_role("button", name="댓글 입력 테스트", exact=True).click()
            expect(test.get_by_role("heading", name="팔로우 확인을 기다려요")).to_be_visible()
            test.get_by_role("button", name="확인 답장·팔로우 조회 테스트").click()
            expect(test.get_by_role("heading", name="메시지가 준비되었어요 💌")).to_be_visible()
            expect(test.locator(".result-bubble")).to_contain_text("qa_friend_ok")
            expect(test.get_by_role("link", name="자료 받아보기")).to_have_attribute("href", "https://example.com/guide")
            test.get_by_role("button", name="닫기", exact=True).click()
            card.get_by_role("switch").click()
            expect(card.locator(".state-badge")).to_have_text("일시 중지")
            card.get_by_role("button", name="브라우저 검증 자동화 수정").click()
            dialog.get_by_role("button", name="다음 단계").click()
            dialog.get_by_label("자동화 이름", exact=False).fill("수정 검증 자동화")
            dialog.get_by_role("button", name="다음 단계").click()
            dialog.get_by_role("button", name="변경사항 저장").click()
            expect(dialog).not_to_be_visible()
            card = page.locator(".automation-card").filter(has_text="수정 검증 자동화")
            expect(card.locator(".state-badge")).to_have_text("일시 중지")
            card.get_by_role("button", name="수정 검증 자동화 삭제").click()
            dialog.get_by_role("button", name="삭제하기").click()
            expect(card).to_have_count(0)
            page.get_by_role("button", name="발송 기록", exact=True).click()
            expect(page.locator("tbody tr")).to_have_count(1)
            page.reload(wait_until="networkidle")
            page.get_by_role("button", name="발송 기록", exact=True).click()
            expect(page.locator("tbody tr")).to_have_count(1)
            mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True)
            mobile.goto(origin, wait_until="networkidle")
            assert not mobile.evaluate("document.documentElement.scrollWidth > innerWidth")
            mobile.get_by_role("button", name="내 콘텐츠", exact=True).click()
            mobile.get_by_role("button", name="자동화 설정하기").first.click()
            expect(mobile.locator(".wiz-post.wiz-selected")).to_have_count(1)
            mobile.get_by_role("dialog").get_by_role("button", name="다음 단계").click()
            expect(mobile.get_by_role("dialog").locator(".wiz-heading h3")).to_have_text("어떤 댓글에 반응할까요?")
            assert not mobile.evaluate("document.documentElement.scrollWidth > innerWidth")
            assert not errors, errors
            browser.close()
            print("PASS: desktop CRUD, follow gating, personalized DM/link, pause preservation, history persistence, local media, mobile preselection and layout; no browser errors.")
    finally:
        server.terminate()
        try:
            server.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.communicate()
