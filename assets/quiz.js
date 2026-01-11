/**
 * =========================
 * JS (одна конверсия Binom + FB Pixel на TG кнопке)
 * =========================
 */

// --- Settings ---
const BOT_USERNAME = "LieScorebot"; // без @
const GEO = "kz";
const BINOM_CONVERSION_URL = "https://mobi-slon.com/click";

// FB Pixel events
const FB_EVENTS = {
  quizStarted: "QuizStarted",
  quizCompleted: "QuizCompleted",
  goTelegram: "GoTelegramAfterQuiz" // это будет на кнопке TG
};

function fbTrackCustom(name){
  try{
    if(!ENABLE_PIXEL) return;
    if(typeof fbq === "function") fbq("trackCustom", name);
  }catch(e){}
}

// --- UTM capture ---
function getQueryObj(){
  const p = new URLSearchParams(location.search);
  const obj = {};
  for(const [k,v] of p.entries()) obj[k] = v;
  return obj;
}
function pick(obj, keys){
  const out = {};
  for(const k of keys) if(obj[k]) out[k] = obj[k];
  return out;
}
function saveUTM(){
  const q = getQueryObj();
  const data = {
    ...pick(q, ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","fbclid"]),
    ts: Date.now()
  };
  const prev = localStorage.getItem("lz_utm");
  if(Object.keys(data).length > 1){
    localStorage.setItem("lz_utm", JSON.stringify(data));
  } else if(!prev){
    localStorage.setItem("lz_utm", JSON.stringify({ts: Date.now()}));
  }
}
function loadUTM(){
  try{ return JSON.parse(localStorage.getItem("lz_utm") || "{}"); }
  catch(e){ return {}; }
}
saveUTM();

// --- Quiz data ---
const RADIO_ANSWERS = [
  { text: "Да",           score: 3 },
  { text: "Скорее да",    score: 2 },
  { text: "Не уверен(а)", score: 1 },
  { text: "Скорее нет",   score: 0 },
];

const QUESTIONS = [
  { type:"radio", key:"q1", text:"Ты когда-нибудь ловил(а) его/её на лжи?" },
  { type:"radio", key:"q2", text:"Есть ощущение, что тебе не договаривают правду?" },
  { type:"input", key:"name", text:"Как зовут человека, по которому у тебя есть сомнения?", placeholder:"Имя (можно без фамилии)", required:true, minLen:2 },
  { type:"radio", key:"q3", text:"Он(а) начинает нервничать, когда ты задаёшь обычные вопросы?" },
  { type:"input", key:"relation", text:"Кем тебе приходится этот человек?", placeholder:"Например: парень, жена, девушка", required:false, minLen:2 },
  { type:"radio", key:"q4", text:"Были ли противоречия в рассказах (даже в мелочах)?" },
  { type:"radio", key:"q5", text:"Если честно — ты сейчас чувствуешь тревогу?" },
];

function getRisk(score){
  if(score >= 10) return "high";
  if(score >= 5) return "mid";
  return "low";
}

function relationCode(raw){
  const s = (raw || "").toLowerCase();
  if(!s) return "na";
  if(s.includes("жена") || s.includes("муж") || s.includes("супруг")) return "sp";
  if(s.includes("пар") || s.includes("дев") || s.includes("бойф") || s.includes("герл")) return "pr";
  if(s.includes("быв")) return "ex";
  return "ot";
}

function escapeHtml(str){
  return (str || "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

// --- DOM ---
const quizCard   = document.getElementById("quizCard");
const resultCard = document.getElementById("resultCard");

const stepText = document.getElementById("stepText");
const progBar  = document.getElementById("progBar");
const qText    = document.getElementById("qText");
const answers  = document.getElementById("answers");
const backBtn  = document.getElementById("backBtn");
const nextBtn  = document.getElementById("nextBtn");
const hint     = document.getElementById("hint");

const rBadge = document.getElementById("rBadge");
const rHead  = document.getElementById("rHead");
const rText  = document.getElementById("rText");
const rList  = document.getElementById("rList");
const tgBtn  = document.getElementById("tgBtn");

// --- State ---
let idx = 0;
const radioScores = {};
const inputData = { name:"", relation:"" };

function radioTotal(){
  return Object.values(radioScores).reduce((s,v)=> s + (v || 0), 0);
}

function setNextEnabled(on){ nextBtn.disabled = !on; }

function setProgress(){
  const total = QUESTIONS.length;
  stepText.textContent = `Вопрос ${idx+1} из ${total}`;
  const pct = Math.round((idx / total) * 100);
  progBar.style.width = `${pct}%`;
}

function render(){
  setProgress();
  hint.textContent = "";
  backBtn.disabled = (idx === 0);
  nextBtn.textContent = (idx === QUESTIONS.length - 1) ? "Получить результат" : "Далее";

  const q = QUESTIONS[idx];
  qText.textContent = q.text;
  answers.innerHTML = "";

  if(q.type === "radio"){
    for(const opt of RADIO_ANSWERS){
      const div = document.createElement("div");
      div.className = "a" + (radioScores[q.key] === opt.score ? " sel" : "");
      div.textContent = opt.text;

      div.addEventListener("click", () => {
        radioScores[q.key] = opt.score;
        [...answers.children].forEach(x => x.classList.remove("sel"));
        div.classList.add("sel");
        setNextEnabled(true);
      });

      answers.appendChild(div);
    }
    setNextEnabled(typeof radioScores[q.key] === "number");
    return;
  }

  if(q.type === "input"){
    const field = document.createElement("div");
    field.className = "field";

    const lbl = document.createElement("div");
    lbl.className = "label";
    lbl.textContent = q.required ? "Обязательное поле" : "Необязательно";
    field.appendChild(lbl);

    const inp = document.createElement("input");
    inp.className = "input";
    inp.type = "text";
    inp.placeholder = q.placeholder || "";
    inp.autocomplete = "off";
    inp.value = (q.key === "name") ? inputData.name : inputData.relation;

    function validateAndStore(){
      const val = inp.value.trim();
      if(q.key === "name") inputData.name = val;
      if(q.key === "relation") inputData.relation = val;

      if(q.required){
        const minLen = q.minLen || 2;
        const ok = val.length >= minLen;
        setNextEnabled(ok);
        hint.textContent = (!ok && val.length > 0) ? `Минимум ${minLen} символа` : "";
      } else {
        setNextEnabled(true);
        hint.textContent = "";
      }
    }

    inp.addEventListener("input", validateAndStore);

    field.appendChild(inp);
    answers.appendChild(field);

    validateAndStore();
    setTimeout(()=>{ try{ inp.focus(); }catch(e){} }, 50);
  }
}

function showResult(){
  const score = radioTotal();
  const risk = getRisk(score);

  const name = (inputData.name || "").trim();
  const relation = (inputData.relation || "").trim();
  const relCode = relationCode(relation);
  const named = name ? "named" : "noname";
  const utm = loadUTM();

  const src = (utm.utm_source || "").toLowerCase().slice(0,10) || "na";
  const cmp = (utm.utm_campaign || "").toLowerCase().slice(0,10) || "na";
  const startParam = `${GEO}_${risk}_${score}_${relCode}_${named}_${src}_${cmp}`;
  const tgLink = `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(startParam)}`;

  let badge = "⚠️";
  let head = "Обнаружены признаки возможной неискренности";
  let text = "";
  let list = [
    "защитная реакция на простые вопросы",
    "противоречия в деталях",
    "уклончивые формулировки и “заученные” ответы"
  ];

  const who = name ? `<b>${escapeHtml(name)}</b>` : "этого человека";

  if(risk === "low"){
    badge = "🟡";
    head = "Сильных сигналов мало — но сомнения не игнорируй";
    text = `По тесту явных признаков немного. Но если интуиция цепляется — проверка голоса часто показывает напряжение, которое сложно спрятать словами.`;
    list = [
      "паузы/запинки в неудобные моменты",
      "скачки тональности и эмоций",
      "уход от прямых ответов"
    ];
  } else if(risk === "mid"){
    badge = "🟠";
    head = "Есть поводы насторожиться";
    text = `По ответам видна связка сигналов, которая часто появляется, когда человек что-то скрывает. Для более точного вывода нужен анализ реального голоса ${who}.`;
  } else {
    badge = "🔴";
    head = "Сигналы выражены — игнорировать рискованно";
    text = `Комбинация ответов указывает на повышенный риск. Это не доказательство, но повод действовать осторожнее и проверить голос ${who} — он выдаёт напряжение сильнее любых слов.`;
  }

  rBadge.textContent = badge;
  rHead.innerHTML = head;
  rText.innerHTML = `
    ${text}<br><br>
    <span style="color:rgba(255,255,255,.72)">
      ${name ? `Мы учли ответы, связанные с <b>${escapeHtml(name)}</b>.` : `Мы учли ответы теста.`}
      ${relation ? ` Тип связи: <b>${escapeHtml(relation)}</b>.` : ``}
    </span>
  `;
  rList.innerHTML = list.map(x => `<li>${x}</li>`).join("");

  quizCard.style.display = "none";
  resultCard.style.display = "block";
  resultCard.scrollIntoView({behavior:"smooth", block:"start"});

  fbTrackCustom(FB_EVENTS.quizCompleted);

  // TG click handler — единая точка
  tgBtn.disabled = false;
  tgBtn.textContent = "🎙 Перейти в Telegram и проанализировать аудио";

  tgBtn.onclick = () => {
    // анти-даблклик
    if (sessionStorage.getItem("lz_tg_sent") === "1") {
      location.href = tgLink;
      return;
    }
    sessionStorage.setItem("lz_tg_sent", "1");

    tgBtn.disabled = true;
    tgBtn.textContent = "Отправляем…";

    // ✅ FB Pixel на кнопку TG
    fbTrackCustom(FB_EVENTS.goTelegram);
    // (если хочешь стандартное событие — раскомментируй)
    // try { if(ENABLE_PIXEL && typeof fbq==="function") fbq("track","Lead"); } catch(e){}

    // ✅ Binom conversion только на кнопку TG
    try{
      if (typeof BPixelJS !== "undefined" && BPixelJS && typeof BPixelJS.conversion === "function") {
        BPixelJS.conversion({ url: BINOM_CONVERSION_URL });
      }
    }catch(e){}

    // дать 180мс, чтобы оба пикселя улетели
    setTimeout(() => {
      location.href = tgLink;
    }, 180);
  };
}

// --- Events ---
backBtn.addEventListener("click", () => {
  if(idx <= 0) return;
  idx--;
  render();
});

nextBtn.addEventListener("click", () => {
  const q = QUESTIONS[idx];

  if(q.type === "input" && q.required){
    const val = (inputData.name || "").trim();
    const minLen = q.minLen || 2;
    if(val.length < minLen){
      hint.textContent = `Введи минимум ${minLen} символа`;
      return;
    }
  }

  if(idx === QUESTIONS.length - 1){
    showResult();
    return;
  }

  idx++;
  render();
});

// init
quizCard.style.display = "block";
render();
fbTrackCustom(FB_EVENTS.quizStarted);
