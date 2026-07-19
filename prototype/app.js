const scenarios = {
  normal: {
    safety: ["normal", "시스템 정상"],
    banner: "normal",
    icon: "✓",
    kicker: "오늘의 점검을 마쳤어요",
    title: "지금은 거래할 필요가 없어요",
    description:
      "모든 자산이 허용 범위 안에 있고 데이터와 계좌 상태도 정상입니다. 다음 점검은 내일 오전 9시예요.",
    action: "점검 결과 보기",
  },
  plan: {
    safety: ["normal", "시스템 정상"],
    banner: "attention",
    icon: "↗",
    kicker: "리밸런싱 계획이 준비됐어요",
    title: "목표 비중을 벗어난 자산이 있어요",
    description:
      "AI 반도체 비중이 허용 범위를 초과했습니다. 주문 전에 변경될 비중과 위험 검사 결과를 확인해 주세요.",
    action: "계획 확인하기",
  },
  blocked: {
    safety: ["blocked", "거래 차단"],
    banner: "blocked",
    icon: "!",
    kicker: "안전을 위해 거래를 멈췄어요",
    title: "가격 데이터가 오래되어 실행할 수 없어요",
    description:
      "새로운 주문은 차단했습니다. 데이터를 다시 확인한 뒤 모든 위험 검사를 통과하면 계획을 새로 만들 수 있어요.",
    action: "최신 정보 가져오기",
  },
  complete: {
    safety: ["normal", "시스템 정상"],
    banner: "complete",
    icon: "✓",
    kicker: "Paper 실행을 완료했어요",
    title: "포트폴리오가 목표 범위로 돌아왔어요",
    description:
      "가상 주문 2건의 체결을 확인했습니다. 실제 계좌에는 어떤 주문도 제출되지 않았어요.",
    action: "실행 결과 보기",
  },
};

const buttons = document.querySelectorAll("[data-scenario]");
const banner = document.querySelector("#status-banner");
const safetyState = document.querySelector("#safety-state");

function setScenario(key) {
  const scenario = scenarios[key];
  if (!scenario) return;

  buttons.forEach((button) => {
    const active = button.dataset.scenario === key;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  banner.className = `status-banner ${scenario.banner}`;
  banner.querySelector(".status-icon").textContent = scenario.icon;
  banner.querySelector("#status-kicker").textContent = scenario.kicker;
  banner.querySelector("#status-title").textContent = scenario.title;
  banner.querySelector("#status-description").textContent = scenario.description;
  banner.querySelector("#status-action").textContent = scenario.action;

  safetyState.className = `safety-state ${scenario.safety[0]}`;
  safetyState.lastElementChild.textContent = scenario.safety[1];
}

buttons.forEach((button) =>
  button.addEventListener("click", () => setScenario(button.dataset.scenario)),
);

const privacyButton = document.querySelector("#privacy-button");
privacyButton.addEventListener("click", () => {
  const enabled = document.body.classList.toggle("privacy-on");
  document.querySelectorAll(".private-value").forEach((element) => {
    element.textContent = enabled ? "••••••••" : element.dataset.value;
  });
  privacyButton.setAttribute("aria-pressed", String(enabled));
  privacyButton.lastChild.textContent = enabled ? " 금액 보기" : " 금액 숨기기";
});

const menuButton = document.querySelector("#menu-button");
menuButton.addEventListener("click", () => {
  const open = document.body.classList.toggle("menu-open");
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
});

document.querySelectorAll(".sidebar a").forEach((link) => {
  link.addEventListener("click", () => {
    document.body.classList.remove("menu-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "메뉴 열기");
  });
});

setScenario("plan");
