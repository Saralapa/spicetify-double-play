// @ts-check
// Double Play — adiciona um 4º modo ao botão de loop do Spotify.
//
// Ciclo do botão passa a ser:
//   0 Não repetir → 1 Repetir → 2 Repetir uma faixa → 3 Repetir uma faixa apenas uma vez
//
// O modo 3 não existe na API do Spotify. Ele é emulado ligando o repeat nativo
// "uma faixa" (2) no início de cada faixa e desligando-o (0) assim que a
// repetição começa — a segunda execução então termina e o player avança sozinho.

(function DoublePlay() {
	"use strict";

	/** Ligue para ver o passo a passo da máquina de estados no DevTools. */
	const DEBUG = false;

	const STORAGE_KEY = "double-play:mode";

	const MODE = { OFF: 0, CONTEXT: 1, TRACK: 2, DOUBLE: 3 };
	const MODE_COUNT = 4;

	const MODE_LABELS = {
		[MODE.OFF]: "Não repetir",
		[MODE.CONTEXT]: "Repetir",
		[MODE.TRACK]: "Repetir uma faixa",
		[MODE.DOUBLE]: "Repetir uma faixa apenas uma vez",
	};
	const DOUBLE_TOOLTIP = "Repetir a faixa uma vez e avançar";

	// Detecção de reinício por progresso (fallback, em ms).
	const NEAR_END_MS = 5000;
	const NEAR_START_MS = 3000;
	// Ignora divergências entre o repeat nativo e o nosso logo após aplicarmos um.
	const RECONCILE_GRACE_MS = 1000;

	const ICON_CLASS = "double-play-icon";
	const ACTIVE_CLASS = "double-play-active";
	const HIDDEN_CLASS = "double-play-native-hidden";
	const STYLE_ID = "double-play-style";

	const BUTTON_SELECTORS = [
		'button[data-testid="control-button-repeat"]',
		".main-repeatButton-button",
		'.player-controls__buttons button[aria-label*="epet" i]',
	];

	function log(...args) {
		if (DEBUG) console.log("[double-play]", ...args);
	}

	function ready() {
		return Boolean(
			window.Spicetify?.Player?.addEventListener &&
				Spicetify.Platform?.PlayerAPI?.setRepeat &&
				Spicetify.SVGIcons?.["repeat-once"] &&
				Spicetify.LocalStorage &&
				document.head &&
				document.body
		);
	}

	if (!ready()) {
		setTimeout(DoublePlay, 300);
		return;
	}

	const playerApi = Spicetify.Platform.PlayerAPI;
	/** Referência original — usada por nós para não reentrar no próprio hook. */
	const nativeSetRepeat = playerApi.setRepeat.bind(playerApi);

	let mode = MODE.OFF;
	/** No modo DOUBLE: true = esta faixa ainda não repetiu. */
	let armed = false;
	let expectedNativeRepeat = null;
	let lastApplyAt = 0;

	let lastPlaybackId = null;
	let lastUri = null;
	let lastProgress = 0;

	/** @type {HTMLElement | null} */
	let button = null;
	/** @type {MutationObserver | null} */
	let buttonObserver = null;

	// ---------------------------------------------------------------- repeat

	function applyNative(value) {
		expectedNativeRepeat = value;
		lastApplyAt = Date.now();
		try {
			const result = nativeSetRepeat(value);
			if (result && typeof result.catch === "function") {
				result.catch((err) => log("setRepeat rejeitou", err));
			}
		} catch (err) {
			log("setRepeat lançou", err);
		}
	}

	function setMode(next, { notify = true } = {}) {
		mode = ((next % MODE_COUNT) + MODE_COUNT) % MODE_COUNT;
		Spicetify.LocalStorage.set(STORAGE_KEY, String(mode));

		if (mode === MODE.DOUBLE) {
			armed = true;
			applyNative(MODE.TRACK);
		} else {
			armed = false;
			applyNative(mode);
		}

		attachButton();
		if (notify) Spicetify.showNotification?.(MODE_LABELS[mode], false, 1500);
		log("modo →", mode, MODE_LABELS[mode]);
	}

	function cycleMode() {
		setMode(mode + 1);
	}

	// O botão de loop e o atalho de teclado passam os dois por aqui. O valor que
	// o Spotify pede é ignorado: avançamos o nosso ciclo de 4 estados.
	playerApi.setRepeat = function doublePlaySetRepeat() {
		cycleMode();
		return Promise.resolve();
	};

	// ------------------------------------------------------- estado do player

	function detectRestart({ playbackId, sameTrack, progress, duration }) {
		const idChanged = playbackId !== null && playbackId !== lastPlaybackId;
		// Fallback para o caso de playbackId não mudar no loop do repeat-one.
		// Exigir que o progresso anterior estivesse perto do fim evita falso
		// positivo quando o usuário arrasta a barra de progresso para trás.
		const wrapped =
			sameTrack &&
			duration > 0 &&
			lastProgress > duration - NEAR_END_MS &&
			progress < NEAR_START_MS;
		return idChanged || wrapped;
	}

	function reconcile(nativeRepeat) {
		if (typeof nativeRepeat !== "number") return;
		if (expectedNativeRepeat === null) {
			expectedNativeRepeat = nativeRepeat;
			return;
		}
		if (nativeRepeat === expectedNativeRepeat) return;
		if (Date.now() - lastApplyAt < RECONCILE_GRACE_MS) return;

		// Mudança veio de fora (Spotify Connect, outro dispositivo): sincroniza e
		// abandona o modo DOUBLE, que não tem equivalente do outro lado.
		log("repeat alterado externamente →", nativeRepeat);
		expectedNativeRepeat = nativeRepeat;
		armed = false;
		mode = nativeRepeat >= MODE.OFF && nativeRepeat <= MODE.TRACK ? nativeRepeat : MODE.OFF;
		Spicetify.LocalStorage.set(STORAGE_KEY, String(mode));
		attachButton();
	}

	function onState() {
		const data = Spicetify.Player.data;
		if (!data) return;

		const uri = data.item?.uri ?? null;
		const playbackId = data.playbackId ?? null;
		const duration = data.duration || Spicetify.Player.getDuration?.() || 0;
		const progress = Spicetify.Player.getProgress?.() ?? 0;
		const sameTrack = uri !== null && uri === lastUri;

		if (mode === MODE.DOUBLE && detectRestart({ playbackId, sameTrack, progress, duration })) {
			if (sameTrack && armed) {
				// A repetição começou: desliga o repeat para que a segunda
				// execução termine avançando para a próxima faixa.
				armed = false;
				applyNative(MODE.OFF);
				log("repetição iniciada → avança ao final desta execução");
			} else {
				// Faixa nova, ou a mesma faixa reiniciada pelo usuário depois de
				// já ter repetido.
				armed = true;
				applyNative(MODE.TRACK);
				log(sameTrack ? "faixa reiniciada → re-armada" : "faixa nova → armada");
			}
		}

		reconcile(data.repeat);

		lastPlaybackId = playbackId;
		lastUri = uri;
		lastProgress = progress;
	}

	// -------------------------------------------------------------- interface

	function injectStyle() {
		if (document.getElementById(STYLE_ID)) return;
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = `
.${HIDDEN_CLASS} { display: none !important; }
.${ACTIVE_CLASS} {
	color: var(--text-bright-accent, #1ed760) !important;
	position: relative !important;
}
/* Redefine o próprio ::after do botão: garante exatamente um ponto de "ativo",
   mesmo enquanto o repeat nativo alterna entre 2 e 0 durante o modo DOUBLE. */
.${ACTIVE_CLASS}::after {
	content: "" !important;
	display: block !important;
	position: absolute !important;
	bottom: 0;
	left: 50%;
	margin-left: -2px;
	width: 4px;
	height: 4px;
	border-radius: 50%;
	background-color: currentColor;
}`;
		document.head.appendChild(style);
	}

	function iconMarkup() {
		// repeat-once + um "selo" (círculo com recorte no fundo) que o diferencia
		// de "repetir uma faixa" mesmo a 16px.
		return `<svg role="img" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="${ICON_CLASS}">${Spicetify.SVGIcons["repeat-once"]}<circle cx="12.8" cy="3.2" r="3.4" fill="var(--background-base, #121212)"></circle><circle cx="12.8" cy="3.2" r="1.9"></circle></svg>`;
	}

	function setAttr(el, name, value) {
		if (el.getAttribute(name) !== value) el.setAttribute(name, value);
	}

	function findButton() {
		for (const selector of BUTTON_SELECTORS) {
			const el = document.querySelector(selector);
			if (el instanceof HTMLElement) return el;
		}
		return null;
	}

	function decorate() {
		if (!button || !button.isConnected) return;

		// Nossas próprias mutações não devem realimentar o observer.
		buttonObserver?.disconnect();
		try {
			if (mode === MODE.DOUBLE) {
				button.classList.add(ACTIVE_CLASS);
				setAttr(button, "aria-label", DOUBLE_TOOLTIP);
				setAttr(button, "title", DOUBLE_TOOLTIP);

				// O ícone do Spotify é escondido, não removido: assim basta
				// reexibi-lo ao sair do modo, sem depender de um re-render.
				for (const svg of button.querySelectorAll(`svg:not(.${ICON_CLASS})`)) {
					svg.classList.add(HIDDEN_CLASS);
				}
				if (!button.querySelector(`.${ICON_CLASS}`)) {
					button.insertAdjacentHTML("beforeend", iconMarkup());
				}
			} else {
				button.classList.remove(ACTIVE_CLASS);
				button.querySelector(`.${ICON_CLASS}`)?.remove();
				for (const svg of button.querySelectorAll(`.${HIDDEN_CLASS}`)) {
					svg.classList.remove(HIDDEN_CLASS);
				}
				const original = button.dataset.doublePlayLabel;
				if (button.getAttribute("aria-label") === DOUBLE_TOOLTIP && original) {
					setAttr(button, "aria-label", original);
				}
				if (button.getAttribute("title") === DOUBLE_TOOLTIP) {
					button.removeAttribute("title");
				}
			}
		} finally {
			observeButton();
		}
	}

	function observeButton() {
		if (!button) return;
		buttonObserver ??= new MutationObserver(() => decorate());
		buttonObserver.observe(button, {
			attributes: true,
			attributeFilter: ["aria-label", "class", "title"],
			childList: true,
			subtree: true,
		});
	}

	function attachButton() {
		const found = findButton();
		if (!found) return;

		if (found !== button) {
			buttonObserver?.disconnect();
			button = found;
			// O rótulo original do Spotify some enquanto decoramos o botão;
			// guardamos para restaurar ao sair do modo DOUBLE.
			const label = button.getAttribute("aria-label");
			if (label && label !== DOUBLE_TOOLTIP) button.dataset.doublePlayLabel = label;
			observeButton();
		}
		decorate();
	}

	// ------------------------------------------------------------------- init

	injectStyle();

	// Semeia o rastreamento antes de armar, para que a primeira atualização de
	// estado não seja lida como reinício de uma faixa já em andamento.
	const initial = Spicetify.Player.data;
	lastPlaybackId = initial?.playbackId ?? null;
	lastUri = initial?.item?.uri ?? null;
	lastProgress = Spicetify.Player.getProgress?.() ?? 0;

	const stored = Number.parseInt(Spicetify.LocalStorage.get(STORAGE_KEY) ?? "", 10);
	setMode(stored === MODE.DOUBLE ? MODE.DOUBLE : initial?.repeat ?? MODE.OFF, { notify: false });

	Spicetify.Player.addEventListener("songchange", onState);
	Spicetify.Player.addEventListener("onprogress", onState);

	attachButton();

	// O botão é recriado quando o React remonta a barra de reprodução.
	new MutationObserver(() => {
		if (!button || !button.isConnected) attachButton();
	}).observe(document.body, { childList: true, subtree: true });

	setTimeout(() => {
		if (!button) {
			console.warn(
				"[double-play] botão de loop não encontrado — o ciclo de 4 modos funciona, " +
					"mas sem ícone próprio para o 4º modo. Verifique os seletores em BUTTON_SELECTORS."
			);
		}
	}, 5000);

	log("carregada");
})();
