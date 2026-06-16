/**
 * Quizora Application Main Controller Module.
 * Manages reactive state, screen updates, Web Audio API synthesis,
 * countdown timers, dynamic category load, and keyboard bindings.
 */

import { localQuestions } from './questions.js';
import { fetchCategories, fetchQuestions } from './api.js';

/* -------------------------------------------------------------------------- */
/*  APPLICATION STATE                                                         */
/* -------------------------------------------------------------------------- */

const state = {
  currentQuestionIndex: 0,
  score: 0,
  selectedAnswer: null,
  answered: false,
  questions: [],
  highScore: 0,
  timer: 15,
  mode: 'local',         // 'local' | 'api'
  soundEnabled: true,
  theme: 'dark',         // 'light' | 'dark'
  apiConfig: {
    amount: 10,
    category: '',
    difficulty: ''
  },
  stats: {
    quizzesPlayed: 0,
    totalQuestions: 0,
    totalCorrect: 0
  }
};

/* -------------------------------------------------------------------------- */
/*  AUDIO SYNTHESIZER (WEB AUDIO API)                                         */
/* -------------------------------------------------------------------------- */

let audioCtx = null;

/**
 * Initializes and resumes the AudioContext on user interaction.
 */
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

/**
 * Synthesizes a clean audio frequency tone.
 */
function playTone(freqStart, freqEnd, duration, type = 'sine') {
  if (!state.soundEnabled) return;
  try {
    initAudio();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, audioCtx.currentTime);
    if (freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, audioCtx.currentTime + duration);
    }
    
    // Smooth fade out to prevent clicks
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (error) {
    console.warn('Sound synthesis error:', error);
  }
}

function playCorrectSound() {
  playTone(523.25, 880, 0.25, 'triangle'); // C5 to A5
}

function playWrongSound() {
  playTone(150, 90, 0.35, 'sawtooth'); // Dissonant low buzz
}

function playVictorySound() {
  if (!state.soundEnabled) return;
  const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5 arpeggio
  notes.forEach((freq, i) => {
    setTimeout(() => {
      playTone(freq, freq * 1.5, 0.3, 'triangle');
    }, i * 110);
  });
}

/* -------------------------------------------------------------------------- */
/*  TIMER SYSTEM                                                              */
/* -------------------------------------------------------------------------- */

let timerInterval = null;

function startTimer() {
  stopTimer();
  state.timer = 15;
  updateTimerUI();

  timerInterval = setInterval(() => {
    state.timer--;
    updateTimerUI();

    if (state.timer <= 0) {
      stopTimer();
      handleTimeOut();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function handleTimeOut() {
  // Lock screen, select nothing, show correct answer
  state.answered = true;
  state.selectedAnswer = null;
  
  announceAccessibility("Time's up! Correct answer revealed.");
  playWrongSound();
  
  renderQuestionState();
  
  // Wait 2 seconds before automatically proceeding
  setTimeout(() => {
    advanceQuiz();
  }, 2000);
}

/* -------------------------------------------------------------------------- */
/*  ACCESSIBILITY & STATE SYNCHRONIZATION                                     */
/* -------------------------------------------------------------------------- */

function announceAccessibility(message) {
  const announcer = document.getElementById('aria-announcer');
  if (announcer) {
    announcer.textContent = message;
  }
}

function syncLocalStorage() {
  localStorage.setItem('quizora_high_score', state.highScore);
  localStorage.setItem('quizora_theme', state.theme);
  localStorage.setItem('quizora_sound', state.soundEnabled);
  localStorage.setItem('quizora_quizzes_played', state.stats.quizzesPlayed);
  localStorage.setItem('quizora_total_questions', state.stats.totalQuestions);
  localStorage.setItem('quizora_total_correct', state.stats.totalCorrect);
}

function loadLocalStorage() {
  const storedHighScore = localStorage.getItem('quizora_high_score');
  if (storedHighScore !== null) {
    state.highScore = parseInt(storedHighScore, 10);
  }

  state.stats.quizzesPlayed = parseInt(localStorage.getItem('quizora_quizzes_played') || '0', 10);
  state.stats.totalQuestions = parseInt(localStorage.getItem('quizora_total_questions') || '0', 10);
  state.stats.totalCorrect = parseInt(localStorage.getItem('quizora_total_correct') || '0', 10);

  const storedTheme = localStorage.getItem('quizora_theme');
  if (storedTheme !== null) {
    state.theme = storedTheme;
  } else {
    // Detect system preferences
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    state.theme = prefersDark ? 'dark' : 'light';
  }

  const storedSound = localStorage.getItem('quizora_sound');
  if (storedSound !== null) {
    state.soundEnabled = storedSound === 'true';
  }
  
  // Apply initial values
  document.documentElement.setAttribute('data-theme', state.theme);
  updateThemeControls();
  updateSoundControls();
  
  // Set start high score display
  document.getElementById('start-high-score').textContent = state.highScore;
}

/* -------------------------------------------------------------------------- */
/*  UI RENDERING & SCREEN TRANSITIONS                                         */
/* -------------------------------------------------------------------------- */

const screens = {
  landing: document.getElementById('landing-screen'),
  start: document.getElementById('start-screen'),
  loading: document.getElementById('loading-screen'),
  error: document.getElementById('error-screen'),
  quiz: document.getElementById('quiz-screen'),
  results: document.getElementById('results-screen')
};

function renderLandingStats() {
  const quizzesPlayedEl = document.getElementById('stat-quizzes-played');
  const accuracyEl = document.getElementById('stat-accuracy');
  const highScoreEl = document.getElementById('stat-high-score');
  const totalQuestionsEl = document.getElementById('stat-total-questions');

  if (quizzesPlayedEl) quizzesPlayedEl.textContent = state.stats.quizzesPlayed;
  if (highScoreEl) highScoreEl.textContent = state.highScore;
  if (totalQuestionsEl) totalQuestionsEl.textContent = state.stats.totalQuestions;

  if (accuracyEl) {
    const accuracy = state.stats.totalQuestions > 0
      ? Math.round((state.stats.totalCorrect / state.stats.totalQuestions) * 100)
      : 0;
    accuracyEl.textContent = `${accuracy}%`;
  }
}

function initLandingScreen() {
  showScreen('landing');
  renderLandingStats();
  announceAccessibility("Welcome to Quizora. Explore your dashboard and enter the arena.");
}

function showScreen(screenKey) {
  Object.keys(screens).forEach((key) => {
    if (key === screenKey) {
      screens[key].classList.add('active');
    } else {
      screens[key].classList.remove('active');
    }
  });
}

/**
 * Renders the full starting options.
 */
async function initStartScreen() {
  showScreen('start');
  document.getElementById('start-high-score').textContent = state.highScore;
  
  // Populate categories if not loaded yet
  const categorySelect = document.getElementById('api-category');
  if (categorySelect.children.length <= 1) {
    try {
      const categories = await fetchCategories();
      categories.forEach((cat) => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        categorySelect.appendChild(option);
      });
    } catch (error) {
      console.warn('Could not pre-load categories dynamically. Using local backup.', error);
    }
  }
}

/**
 * Updates the timer ring & progress.
 */
function updateTimerUI() {
  const timerText = document.getElementById('timer-text');
  const timerStroke = document.getElementById('timer-stroke');
  
  if (timerText) timerText.textContent = state.timer;

  if (timerStroke) {
    // Percentage remaining (15s base)
    const percentage = (state.timer / 15) * 100;
    timerStroke.setAttribute('stroke-dasharray', `${percentage}, 100`);
    
    // Visual alerts for low time
    if (state.timer <= 4) {
      timerStroke.style.stroke = 'var(--error)';
      if (timerText) timerText.style.color = 'var(--error)';
    } else {
      timerStroke.style.stroke = 'var(--accent-color)';
      if (timerText) timerText.style.color = 'var(--text-primary)';
    }
  }
}

/**
 * Renders the question details inside the Quiz Screen.
 */
function renderQuestion() {
  const currentQuestion = state.questions[state.currentQuestionIndex];
  if (!currentQuestion) return;

  // Header stats
  const total = state.questions.length;
  document.getElementById('quiz-progress').textContent = `Question ${state.currentQuestionIndex + 1} of ${total}`;
  document.getElementById('quiz-score').textContent = `Score: ${state.score}`;

  // Progress Bar
  const progressPercent = ((state.currentQuestionIndex) / total) * 100;
  const progressBar = document.getElementById('progress-bar');
  progressBar.style.width = `${progressPercent}%`;
  progressBar.setAttribute('aria-valuenow', progressPercent);

  // Question Content
  document.getElementById('question-text').textContent = currentQuestion.question;

  // Populate Option Buttons
  const container = document.getElementById('options-container');
  container.innerHTML = '';

  currentQuestion.options.forEach((option, index) => {
    const button = document.createElement('button');
    button.className = 'option-btn';
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.innerHTML = `
      <span class="option-text">${option}</span>
      <span class="indicator-icon-wrapper"></span>
    `;

    button.addEventListener('click', () => {
      if (!state.answered) {
        selectAnswer(index);
      }
    });

    container.appendChild(button);
  });

  // Action Buttons Setup
  const nextBtn = document.getElementById('next-btn');
  nextBtn.classList.add('hidden');
  nextBtn.querySelector('span').textContent = 
    (state.currentQuestionIndex === total - 1) ? 'Finish Quiz' : 'Next Question';

  announceAccessibility(`Question ${state.currentQuestionIndex + 1}: ${currentQuestion.question}`);
  startTimer();
}

/**
 * Applies visual colors/classes and indicators depending on validation answers.
 */
function renderQuestionState() {
  const currentQuestion = state.questions[state.currentQuestionIndex];
  const container = document.getElementById('options-container');
  const buttons = container.querySelectorAll('.option-btn');
  const nextBtn = document.getElementById('next-btn');

  // Update progress bar to include answered status
  const total = state.questions.length;
  const progressPercent = ((state.currentQuestionIndex + 1) / total) * 100;
  const progressBar = document.getElementById('progress-bar');
  progressBar.style.width = `${progressPercent}%`;
  progressBar.setAttribute('aria-valuenow', progressPercent);

  buttons.forEach((btn, index) => {
    btn.classList.add('disabled');
    btn.setAttribute('aria-disabled', 'true');

    const wrapper = btn.querySelector('.indicator-icon-wrapper');

    if (index === currentQuestion.correctAnswer) {
      btn.classList.add('correct');
      btn.setAttribute('aria-checked', 'true');
      wrapper.innerHTML = `
        <span class="indicator-icon" aria-label="Correct Answer">✓</span>
      `;
    } else if (index === state.selectedAnswer) {
      btn.classList.add('wrong');
      btn.setAttribute('aria-checked', 'true');
      wrapper.innerHTML = `
        <span class="indicator-icon" aria-label="Incorrect Answer">✗</span>
      `;
    }
  });

  // Show Next button if not timer-auto-advancing (or when user clicks answer manually)
  if (state.selectedAnswer !== null) {
    nextBtn.classList.remove('hidden');
    nextBtn.focus();
  }
}

/**
 * Evaluates selected option score status.
 */
function selectAnswer(index) {
  stopTimer();
  state.answered = true;
  state.selectedAnswer = index;

  const currentQuestion = state.questions[state.currentQuestionIndex];
  const isCorrect = (index === currentQuestion.correctAnswer);

  if (isCorrect) {
    state.score++;
    playCorrectSound();
    announceAccessibility("Correct! " + currentQuestion.options[index]);
  } else {
    playWrongSound();
    announceAccessibility(`Wrong. Selected ${currentQuestion.options[index]}. Correct is ${currentQuestion.options[currentQuestion.correctAnswer]}.`);
  }

  document.getElementById('quiz-score').textContent = `Score: ${state.score}`;
  renderQuestionState();
}

/**
 * Decides whether to proceed to next question or display result dashboard.
 */
function advanceQuiz() {
  state.currentQuestionIndex++;
  state.answered = false;
  state.selectedAnswer = null;

  if (state.currentQuestionIndex < state.questions.length) {
    renderQuestion();
  } else {
    showResults();
  }
}

/**
 * Summarizes score tracking and checks high score values.
 */
function showResults() {
  stopTimer();
  showScreen('results');

  const total = state.questions.length;
  const percentage = Math.round((state.score / total) * 100);
  
  // Elements
  const emojiEl = document.getElementById('results-emoji');
  const headlineEl = document.getElementById('results-headline');
  const subtextEl = document.getElementById('results-subtext');
  const newRecordEl = document.getElementById('new-record-banner');

  // Performance Text
  let emoji = '📚';
  let headline = 'Keep Practicing!';
  let subtext = 'Keep at it and you will improve next time.';

  if (percentage >= 90) {
    emoji = '🏆';
    headline = 'Excellent!';
    subtext = 'Stellar performance! You really know your stuff.';
  } else if (percentage >= 70) {
    emoji = '🌟';
    headline = 'Great Job!';
    subtext = 'Outstanding work. You did incredibly well!';
  } else if (percentage >= 50) {
    emoji = '👍';
    headline = 'Good Effort!';
    subtext = 'Decent showing. A little more revision and you will master it.';
  }

  emojiEl.textContent = emoji;
  headlineEl.textContent = headline;
  subtextEl.textContent = subtext;

  // Update cumulative stats
  state.stats.quizzesPlayed++;
  state.stats.totalQuestions += total;
  state.stats.totalCorrect += state.score;

  // Track high score
  let isNewRecord = false;
  if (state.score > state.highScore) {
    state.highScore = state.score;
    isNewRecord = true;
  }
  syncLocalStorage();

  // Record Banner
  if (isNewRecord) {
    newRecordEl.classList.remove('hidden');
  } else {
    newRecordEl.classList.add('hidden');
  }

  // Populate Metric Grid
  document.getElementById('results-score-text').textContent = `${state.score} / ${total}`;
  document.getElementById('results-percentage').textContent = `${percentage}%`;
  document.getElementById('results-correct').textContent = state.score;
  document.getElementById('results-incorrect').textContent = total - state.score;
  document.getElementById('results-high-score-val').textContent = state.highScore;

  playVictorySound();
  announceAccessibility(`Quiz complete. Final score is ${state.score} out of ${total}. Performance is: ${headline}`);
}

/* -------------------------------------------------------------------------- */
/*  THEMING AND AUDIO TOGGLES                                                 */
/* -------------------------------------------------------------------------- */

function toggleTheme() {
  state.theme = (state.theme === 'dark') ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  updateThemeControls();
  syncLocalStorage();
  
  // Play subtle sound feedback
  playTone(300, 450, 0.08, 'sine');
}

function updateThemeControls() {
  const sun = document.querySelector('.sun-icon');
  const moon = document.querySelector('.moon-icon');
  
  if (state.theme === 'dark') {
    sun.classList.add('hidden');
    moon.classList.remove('hidden');
  } else {
    sun.classList.remove('hidden');
    moon.classList.add('hidden');
  }
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  updateSoundControls();
  syncLocalStorage();

  // Play subtle sound test if enabling
  if (state.soundEnabled) {
    initAudio();
    playTone(440, 554.37, 0.1, 'sine');
  }
}

function updateSoundControls() {
  const soundBtn = document.getElementById('sound-toggle');
  const soundOn = document.querySelector('.sound-on-icon');
  const soundOff = document.querySelector('.sound-off-icon');

  soundBtn.setAttribute('aria-pressed', state.soundEnabled ? 'true' : 'false');

  if (state.soundEnabled) {
    soundOn.classList.remove('hidden');
    soundOff.classList.add('hidden');
  } else {
    soundOn.classList.add('hidden');
    soundOff.classList.remove('hidden');
  }
}

/* -------------------------------------------------------------------------- */
/*  QUIZ INITIALIZATION / ACTION FLOWS                                        */
/* -------------------------------------------------------------------------- */

/**
 * Setup and query the appropriate resource array.
 */
async function startQuiz() {
  initAudio();
  
  state.score = 0;
  state.currentQuestionIndex = 0;
  state.answered = false;
  state.selectedAnswer = null;

  const amountSelect = document.getElementById('question-amount');
  const apiCategory = document.getElementById('api-category');
  const apiDifficulty = document.getElementById('api-difficulty');

  state.apiConfig.amount = parseInt(amountSelect.value, 10);
  state.apiConfig.category = apiCategory.value;
  state.apiConfig.difficulty = apiDifficulty.value;

  if (state.mode === 'local') {
    // Slice questions to match user selection count
    const shuffledLocal = [...localQuestions].sort(() => 0.5 - Math.random());
    state.questions = shuffledLocal.slice(0, state.apiConfig.amount);
    
    showScreen('quiz');
    renderQuestion();
  } else {
    // Fetch from Open Trivia API
    showScreen('loading');
    
    try {
      const fetched = await fetchQuestions(state.apiConfig);
      if (fetched.length === 0) {
        throw new Error('No questions retrieved');
      }
      state.questions = fetched;
      showScreen('quiz');
      renderQuestion();
    } catch (error) {
      showScreen('error');
    }
  }
}

function restartQuiz() {
  initLandingScreen();
}

/* -------------------------------------------------------------------------- */
/*  EVENT LISTENERS & BINDINGS                                                */
/* -------------------------------------------------------------------------- */

function bindEvents() {
  // Mode Button selection
  const localBtn = document.getElementById('mode-local-btn');
  const apiBtn = document.getElementById('mode-api-btn');
  const apiOptions = document.getElementById('api-options');

  localBtn.addEventListener('click', () => {
    state.mode = 'local';
    localBtn.classList.add('active');
    localBtn.setAttribute('aria-pressed', 'true');
    apiBtn.classList.remove('active');
    apiBtn.setAttribute('aria-pressed', 'false');
    apiOptions.classList.add('hidden');
    
    // Sound feedback
    playTone(350, 400, 0.08, 'sine');
  });

  apiBtn.addEventListener('click', () => {
    state.mode = 'api';
    apiBtn.classList.add('active');
    apiBtn.setAttribute('aria-pressed', 'true');
    localBtn.classList.remove('active');
    localBtn.setAttribute('aria-pressed', 'false');
    apiOptions.classList.remove('hidden');
    
    // Sound feedback
    playTone(350, 400, 0.08, 'sine');
  });

  // Action triggers
  document.getElementById('enter-arena-btn').addEventListener('click', () => {
    playTone(400, 500, 0.1, 'sine');
    initStartScreen();
  });

  document.getElementById('back-to-landing-btn').addEventListener('click', () => {
    playTone(300, 250, 0.1, 'sine');
    initLandingScreen();
  });

  document.getElementById('start-quiz-btn').addEventListener('click', startQuiz);
  document.getElementById('retry-btn').addEventListener('click', startQuiz);
  document.getElementById('restart-btn').addEventListener('click', restartQuiz);
  
  document.getElementById('next-btn').addEventListener('click', () => {
    advanceQuiz();
  });

  // Settings bar controls
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('sound-toggle').addEventListener('click', toggleSound);

  // Keyboard navigation mappings
  document.addEventListener('keydown', (e) => {
    // 1-4 option button mappings on active Quiz Screen
    if (screens.quiz.classList.contains('active') && !state.answered) {
      if (['1', '2', '3', '4'].includes(e.key)) {
        const optionIdx = parseInt(e.key, 10) - 1;
        const options = document.querySelectorAll('.option-btn');
        if (options[optionIdx]) {
          options[optionIdx].click();
        }
      }
    }

    // Space/Enter mapping for primary CTA controls
    if (e.key === 'Enter' || e.key === ' ') {
      const activeScreen = Object.keys(screens).find(key => screens[key].classList.contains('active'));
      
      // Stop space key scrolling default action
      if (e.key === ' ' && ['button', 'select'].includes(document.activeElement.tagName.toLowerCase())) {
        return; // Let native events execute
      }
      
      if (e.key === ' ') {
        e.preventDefault();
      }

      if (activeScreen === 'landing') {
        initStartScreen();
      } else if (activeScreen === 'start') {
        startQuiz();
      } else if (activeScreen === 'quiz' && state.answered) {
        advanceQuiz();
      } else if (activeScreen === 'results') {
        restartQuiz();
      } else if (activeScreen === 'error') {
        startQuiz();
      }
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  ENTRY POINT                                                               */
/* -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  loadLocalStorage();
  bindEvents();
  initLandingScreen();
});
