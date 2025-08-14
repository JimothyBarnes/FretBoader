import React, { useState, useEffect, useReducer, useMemo, useRef } from 'react';

// --- Audio Engine ---
let ToneLib = null;
// Primary: free, CC-licensed clean electric guitar samples (GitHub Pages)
const REMOTE_SAMPLE_BASE = 'https://nbrosowsky.github.io/tonejs-instruments/samples/guitar-electric/';
// Optional: local fallback path if you want to vendor files into your app
const LOCAL_SAMPLE_BASE = '/samples/clean-electric/';
// Minimal keymap across the range; Tone.Sampler will pitch-shift in-between
const SAMPLE_URLS = { E2: 'E2.mp3', A2: 'A2.mp3', D3: 'D3.mp3', G3: 'G3.mp3', B3: 'B3.mp3', E4: 'E4.mp3' };
const audioEngine = {
  synth: null,
  isInitialized: false,
  _queue: [],
  async init() {
    if (this.isInitialized) return;
    try {
      // Ensure Tone is available and audio context is running
      if (!ToneLib) {
        ToneLib = await import('tone');
      }
      await ToneLib.start();
      if (ToneLib.getContext().state !== 'running') {
        await ToneLib.getContext().resume();
      }

      // Try remote CDN first (GitHub Pages, CORS-enabled)
      try {
        this.synth = new ToneLib.Sampler({
          urls: SAMPLE_URLS,
          attack: 0.002,
          release: 1.2,
          curve: 'exponential'
        }, { baseUrl: REMOTE_SAMPLE_BASE }).toDestination();
        await this.synth.loaded;
      } catch (errCdn) {
        console.warn('[audio] Remote samples failed, trying local fallback...', errCdn);
        try {
          // Local fallback (if you add files under /samples/clean-electric/)
          this.synth = new ToneLib.Sampler({
            urls: SAMPLE_URLS,
            attack: 0.002,
            release: 1.2,
            curve: 'exponential'
          }, { baseUrl: LOCAL_SAMPLE_BASE }).toDestination();
          await this.synth.loaded;
        } catch (errLocal) {
          console.warn('[audio] Local samples failed, falling back to PluckSynth', errLocal);
          this.synth = new ToneLib.PluckSynth({ attackNoise: 0.8, dampening: 5200, resonance: 0.9 }).toDestination();
        }
      }

      this.isInitialized = true;
      console.info('[audio] ready');
      // Drain any queued notes
      const now = ToneLib.now();
      const q = this._queue.splice(0);
      q.forEach((item, i) => {
        try { this.synth.triggerAttackRelease(item.note, item.dur || '8n', now + i * 0.05); } catch (e) {}
      });
    } catch (e) {
      console.error('Could not start audio context', e);
    }
  },
  playNote(note, dur = '8n') {
    if (!this.isInitialized || !this.synth || !ToneLib) {
      this._queue.push({ note, dur });
      return;
    }
    try {
      if (typeof this.synth.triggerAttackRelease === 'function') {
        this.synth.triggerAttackRelease(note, dur);
      } else if (typeof this.synth.triggerAttack === 'function') {
        this.synth.triggerAttack(note);
      }
    } catch (e) {
      console.warn('[audio] playNote failed', e);
    }
  },
  playCorrectSound(arg) {
    if (arg && typeof arg === 'object' && arg.stringIndex != null) {
      const { stringIndex, fretIndex, instrument, note } = arg;
      try {
        const midi = computeStringFretMidi(instrument || 'Guitar', stringIndex, fretIndex);
        const name = ToneLib ? ToneLib.Frequency(midi, 'midi').toNote() : null;
        this.playNote(name || (note ? `${note}4` : 'E4'));
      } catch (e) {
        if (typeof note === 'string') this.playNote(`${note}4`);
        else this.playNote('E4');
      }
    } else if (typeof arg === 'string') {
      const noteWithOctave = `${arg}4`;
      this.playNote(noteWithOctave);
    } else {
      this.playNote('E4');
    }
  },
  playIncorrectSound() {
    this.playNote('E2');
  },
  playStartSound() {
    if (!this.isInitialized || !this.synth || !ToneLib) return;
    const now = ToneLib.now();
    try {
      if (typeof this.synth.triggerAttackRelease === 'function') {
        this.synth.triggerAttackRelease('C4', '8n', now);
        this.synth.triggerAttackRelease('E4', '8n', now + 0.1);
        this.synth.triggerAttackRelease('G4', '8n', now + 0.2);
      } else if (typeof this.synth.triggerAttack === 'function') {
        this.synth.triggerAttack('C4', now);
        this.synth.triggerAttack('E4', now + 0.1);
        this.synth.triggerAttack('G4', now + 0.2);
      }
    } catch (e) {
      console.warn('[audio] startSound failed', e);
    }
  }
};

// --- Music Theory Constants ---
const ALL_NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const WHOLE_NOTES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const SCALES = {
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Natural Minor': [0, 2, 3, 5, 7, 8, 10],
  'Major Pentatonic': [0, 2, 4, 7, 9],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// --- Instrument Definitions ---
const INSTRUMENTS = {
  'Guitar':   { tuning: ['E', 'B', 'G', 'D', 'A', 'E'], frets: 13 },
  'Bass':     { tuning: ['G', 'D', 'A', 'E'], frets: 13 },
  'Ukulele':  { tuning: ['A', 'E', 'C', 'G'], frets: 13 },
  'Mandolin': { tuning: ['E', 'A', 'D', 'G'], frets: 13 },
};

// --- Helper Functions ---
const generateFretboardLayout = (tuning, fretCount) => {
  return tuning.map(openNote => {
    const string = [openNote];
    let lastNoteIndex = ALL_NOTES.indexOf(openNote);
    for (let i = 0; i < fretCount - 1; i++) {
      lastNoteIndex = (lastNoteIndex + 1) % 12;
      string.push(ALL_NOTES[lastNoteIndex]);
    }
    return string;
  });
};

const getFretKey = (stringIndex, fretIndex) => `${stringIndex}-${fretIndex}`;

const getNotesInScale = (rootNote, scaleIntervals) => {
  const rootIndex = ALL_NOTES.indexOf(rootNote);
  if (rootIndex === -1) return [];
  return scaleIntervals.map(interval => ALL_NOTES[(rootIndex + interval) % 12]);
};

const findAllNotePositions = (notesToFind, range, fretboardLayout) => {
  const positions = [];
  const notes = Array.isArray(notesToFind) ? notesToFind : [notesToFind];
  fretboardLayout.forEach((string, sIndex) => {
    string.forEach((note, fIndex) => {
      if (notes.includes(note) && fIndex >= range[0] && fIndex <= range[1]) {
        positions.push(getFretKey(sIndex, fIndex));
      }
    });
  });
  return positions;
};

const shuffleArray = (array) => {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
};

// Pitch mapping helpers for realistic string octaves
const NOTE_TO_INDEX = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
const OPEN_STRING_MIDI = {
  'Guitar':   [64, 59, 55, 50, 45, 40], // High E4 (top) -> Low E2 (bottom)
  'Bass':     [43, 38, 33, 28],        // G2, D2, A1, E1
  'Ukulele':  [69, 64, 60, 67],        // A4, E4, C4, G4 (re-entrant)
  'Mandolin': [76, 69, 62, 55],        // E5, A4, D4, G3
};
const computeStringFretMidi = (instrument, stringIndex, fretIndex) => {
  const arr = OPEN_STRING_MIDI[instrument] || OPEN_STRING_MIDI['Guitar'];
  const base = arr[stringIndex] != null ? arr[stringIndex] : arr[0];
  return base + fretIndex;
};

// Helper to compute CSS grid columns for shrinking fret widths
const computeFretColumns = (fretCount) => {
  if (!Number.isFinite(fretCount) || fretCount <= 0) return 'repeat(12, 1fr)';
  const weights = Array.from({ length: fretCount }, (_, i) => Math.pow(2, -(i + 1) / 12));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => `${(w / sum).toFixed(4)}fr`).join(' ');
};

// --- State Management (Reducer) ---
const initialState = {
  gameStarted: false,
  isGameOver: false,
  isPracticeMode: false,
  isReviewing: false,
  timer: 0,
  noteQueue: [],
  noteQueueIndex: 0,
  currentNote: '',
  notesToFind: [],
  message: 'Select an instrument and mode, then click "Play" to begin!',
  foundFrets: [],
  flashFret: null,
  totalNotesInRound: 0,
  totalFretsFoundInRound: 0,
  shakeFret: null,
  revealedFrets: {},
};

function gameReducer(state, action) {
  switch (action.type) {
    case 'START_GAME': {
      const { gameMode, fretRange, rootNote, scaleType, isWholeNotesMode, isPractice, fretboardLayout } = action.payload;
      let notesToFindInMode = [];
      let noteQueueForMode = [];
      let messageForMode = '';
      let totalNotes = 0;

      if (gameMode === 'findNote') {
        const notesInRange = new Set();
        fretboardLayout.forEach(string => {
          for (let fIndex = fretRange[0]; fIndex <= fretRange[1]; fIndex++) {
            const note = string[fIndex];
            if (!isWholeNotesMode || WHOLE_NOTES.includes(note)) {
              notesInRange.add(note);
            }
          }
        });
        noteQueueForMode = shuffleArray([...notesInRange]);
        if (noteQueueForMode.length === 0) {
          return { ...initialState, message: "No notes available in this range." };
        }
        noteQueueForMode.forEach(note => {
          totalNotes += findAllNotePositions([note], fretRange, fretboardLayout).length;
        });
        const firstNote = noteQueueForMode[0];
        notesToFindInMode = [firstNote];
        messageForMode = `Find all the ${firstNote} notes!`;
      } else { // gameMode === 'scaleDrill'
        notesToFindInMode = getNotesInScale(rootNote, SCALES[scaleType]);
        totalNotes = findAllNotePositions(notesToFindInMode, fretRange, fretboardLayout).length;
        messageForMode = isPractice ? `Practice the ${rootNote} ${scaleType} scale.` : `Find all notes in ${rootNote} ${scaleType}!`;
      }

      return {
        ...initialState,
        gameStarted: true,
        isPracticeMode: isPractice,
        noteQueue: noteQueueForMode,
        currentNote: noteQueueForMode.length > 0 && !isPractice ? noteQueueForMode[0] : '',
        notesToFind: notesToFindInMode,
        message: messageForMode,
        totalNotesInRound: totalNotes,
      };
    }
    case 'STOP_GAME': {
      return { ...initialState, message: 'Game Stopped. Click "Play" to start again!' };
    }
    case 'TICK_TIMER': {
      if (!state.gameStarted || state.isGameOver || state.isPracticeMode) return state;
      return { ...state, timer: state.timer + 0.01 };
    }
    case 'TICK_TIMER_DELTA': {
      if (!state.gameStarted || state.isGameOver || state.isPracticeMode) return state;
      return { ...state, timer: state.timer + (action.payload || 0) };
    }
    case 'CORRECT_GUESS': {
      const { clickedFretKey } = action.payload;
      if (state.foundFrets.includes(clickedFretKey)) {
        return { ...state, message: "You already found that one!" };
      }
      const newFoundFrets = [...state.foundFrets, clickedFretKey];
      return {
        ...state,
        message: 'Correct!',
        foundFrets: newFoundFrets,
        flashFret: clickedFretKey,
        totalFretsFoundInRound: state.totalFretsFoundInRound + 1,
      };
    }
    case 'INCORRECT_GUESS': {
      if (state.isPracticeMode) return state;
      return {
        ...state,
        message: 'Not quite! Here are the correct notes.',
        isReviewing: true,
      };
    }
    case 'END_REVIEW': {
      return { ...state, isReviewing: false, message: 'Continue finding the notes.' };
    }
    case 'ADVANCE_NOTE': {
      const newIndex = state.noteQueueIndex + 1;
      if (newIndex >= state.noteQueue.length) {
        const finalMessage = state.isPracticeMode ? 'Practice Complete!' : `Finished! Final Time: ${state.timer.toFixed(2)}s`;
        return {
          ...state,
          gameStarted: false,
          isGameOver: true,
          message: finalMessage,
        }
      }
      const newNote = state.noteQueue[newIndex];
      return {
        ...state,
        foundFrets: [],
        noteQueueIndex: newIndex,
        currentNote: newNote,
        notesToFind: [newNote],
        message: `All found! Now find all the ${newNote} notes!`
      };
    }
    case 'GAME_OVER': {
      const finalMessage = state.isPracticeMode ? 'Practice Complete!' : `Finished! Final Time: ${action.payload.finalTime.toFixed(2)}s`;
      return {
        ...state,
        gameStarted: false,
        isGameOver: true,
        message: finalMessage,
      }
    }
    case 'CLEAR_FLASH': {
      return { ...state, flashFret: null };
    }
    case 'FLASH_INCORRECT': {
      return { ...state, shakeFret: action.payload.clickedFretKey };
    }
    case 'CLEAR_SHAKE': {
      return { ...state, shakeFret: null };
    }
    case 'REVEAL_FRET': {
      const { fretKey, note } = action.payload;
      return { ...state, revealedFrets: { ...state.revealedFrets, [fretKey]: note } };
    }
    case 'HIDE_REVEAL': {
      const { fretKey } = action.payload;
      const updated = { ...state.revealedFrets };
      delete updated[fretKey];
      return { ...state, revealedFrets: updated };
    }
    default:
      return state;
  }
}

// --- Child Components ---

const TimerDisplay = ({ time }) => (
  <div className="flex items-center justify-around text-slate-300">
    <div className="text-center px-4">
      <p className="text-sm font-medium text-slate-400">Time</p>
      <p className="text-3xl font-bold text-white mt-1 w-32">{time.toFixed(2)}</p>
    </div>
  </div>
);

const FinalTimeDisplay = ({ time }) => (
  <div className="flex items-center justify-center text-slate-300">
    <div className="text-center">
      <p className="text-sm font-medium text-slate-400">Final Time</p>
      <p className="text-4xl font-bold text-blue-400 mt-1">{time.toFixed(2)}s</p>
    </div>
  </div>
);

// --- Toolbar UI helpers (pill-style tags) ---
const TAG_COLORS = {
  violet: { border: 'border-violet-500', text: 'text-violet-400', dot: 'bg-violet-500' },
  cyan:   { border: 'border-cyan-500',   text: 'text-cyan-400',   dot: 'bg-cyan-500' },
  blue:   { border: 'border-blue-500',   text: 'text-blue-400',   dot: 'bg-blue-500' },
  green:  { border: 'border-green-500',  text: 'text-green-400',  dot: 'bg-green-500' },
  slate:  { border: 'border-slate-600',  text: 'text-slate-400',  dot: 'bg-slate-500' },
};

const TagToggle = ({ color = 'blue', active = false, text, onClick, disabled = false }) => {
  const c = active && !disabled ? (TAG_COLORS[color] || TAG_COLORS.blue) : TAG_COLORS.slate;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border-2 ${c.border} ${c.text} bg-slate-900/50 disabled:opacity-50`}
    >
      <span className={`w-2 h-2 rounded-full ${active && !disabled ? c.dot : 'bg-slate-500'}`}></span>
      <span className="whitespace-nowrap">{text}</span>
    </button>
  );
};

// --- Custom dropdown (TagMenu) matching the pill style ---
const TagMenu = ({ color = 'blue', display, value, options, onChange, disabled = false, ariaLabel }) => {
  const c = disabled ? TAG_COLORS.slate : (TAG_COLORS[color] || TAG_COLORS.blue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex(o => String(o.value) === String(value))));
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    setActiveIndex(Math.max(0, options.findIndex(o => String(o.value) === String(value))));
  }, [value, options]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!open) return;
      const t = triggerRef.current;
      const l = listRef.current;
      if (t && !t.contains(e.target) && l && !l.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selectValue = (val) => {
    if (disabled) return;
    onChange && onChange({ target: { value: val } });
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); setActiveIndex(i => Math.min(options.length - 1, (open ? i : -1) + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) setOpen(true); setActiveIndex(i => Math.max(0, (open ? i : 1) - 1)); }
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Home') { e.preventDefault(); setActiveIndex(0); }
    else if (e.key === 'End') { e.preventDefault(); setActiveIndex(options.length - 1); }
  };

  return (
    <div className="relative inline-flex" ref={triggerRef}>
      <button
        type="button"
        role="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || display}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={onKeyDown}
        className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border-2 ${c.border} ${c.text} bg-slate-900/50 ${disabled ? 'opacity-50' : 'hover:brightness-110'} transition`}
      >
        <span className={`w-2 h-2 rounded-full ${c.dot}`}></span>
        <span className="whitespace-nowrap">{display}</span>
        <svg className="w-3 h-3 opacity-80" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M6 8l4 4 4-4"/></svg>
      </button>

      {open && !disabled && (
        <div
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          className="absolute z-50 mt-2 min-w-[10rem] right-0 rounded-xl border-2 border-slate-700 bg-slate-900/95 shadow-xl p-1"
        >
          {options.map((opt, idx) => {
            const selected = String(opt.value) === String(value);
            const active = idx === activeIndex;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectValue(opt.value)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${active ? 'bg-slate-800' : ''} ${selected ? 'ring-1 ring-blue-500' : 'hover:bg-slate-800'}`}
              >
                <span className={`w-2 h-2 rounded-full ${selected ? c.dot : 'bg-slate-500'}`}></span>
                <span className="text-sm text-slate-200 flex-1">{opt.label}</span>
                {selected && (
                  <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M7.5 13.5l-3-3 1.4-1.4L7.5 10.7l6.6-6.6 1.4 1.4z"/></svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Toolbar = ({ instrument, setInstrument, gameMode, setGameMode, rootNote, setRootNote, scaleType, setScaleType, isWholeNotesMode, setIsWholeNotesMode, gameStarted, audioReady }) => {
  const instrumentOptions = Object.keys(INSTRUMENTS).map(inst => ({ value: inst, label: inst }));
  const modeOptions = [
    { value: 'findNote', label: 'Note Cycle' },
    { value: 'scaleDrill', label: 'Scale Drill' },
  ];
  const rootOptions = ALL_NOTES.map(n => ({ value: n, label: n }));
  const scaleOptions = Object.keys(SCALES).map(s => ({ value: s, label: s }));

  return (
    <div className="flex items-center justify-between mb-4 px-2 py-3 bg-slate-900/50 rounded-xl border border-slate-700">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-white pl-2">FretBoarder</h1>
        <span className={`ml-1 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border-2 ${audioReady ? 'border-green-500 text-green-400' : 'border-slate-600 text-slate-400'} bg-slate-900/50`}>
          <span className={`w-2 h-2 rounded-full ${audioReady ? 'bg-green-500' : 'bg-slate-500'}`}></span>
          Audio
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap justify-end">
        <TagMenu
          color="violet"
          display={`🎸 ${instrument}`}
          value={instrument}
          options={instrumentOptions}
          onChange={e => setInstrument(e.target.value)}
          disabled={gameStarted}
          ariaLabel="Instrument"
        />

        <TagMenu
          color="cyan"
          display={gameMode === 'findNote' ? '🎯 Note Cycle' : '🎼 Scale Drill'}
          value={gameMode}
          options={modeOptions}
          onChange={e => setGameMode(e.target.value)}
          disabled={gameStarted}
          ariaLabel="Mode"
        />

        {gameMode === 'scaleDrill' && (
          <>
            <TagMenu
              color="blue"
              display={`Root: ${rootNote}`}
              value={rootNote}
              options={rootOptions}
              onChange={e => setRootNote(e.target.value)}
              disabled={gameStarted}
              ariaLabel="Root Note"
            />
            <TagMenu
              color="blue"
              display={`Scale: ${scaleType}`}
              value={scaleType}
              options={scaleOptions}
              onChange={e => setScaleType(e.target.value)}
              disabled={gameStarted}
              ariaLabel="Scale Type"
            />
          </>
        )}

        {gameMode === 'findNote' && (
          <TagToggle
            color="blue"
            active={isWholeNotesMode}
            text="Natural Notes Only"
            onClick={() => !gameStarted && setIsWholeNotesMode(!isWholeNotesMode)}
            disabled={gameStarted}
          />
        )}
      </div>
    </div>
  );
};

const Fret = ({ stringIndex, fretIndex, note, handleFretClick, foundFrets, flashFret, shakeFret, revealedFrets, fretRange, isReviewing, isPracticeMode, notesToFind, isWholeNotesMode }) => {
  const fretKey = getFretKey(stringIndex, fretIndex);
  const isFound = foundFrets.includes(fretKey);
  const isFlashing = flashFret === fretKey;
  const isShaking = shakeFret === fretKey;
  const isInRange = fretIndex >= fretRange[0] && fretIndex <= fretRange[1];
  const isCorrectNote = notesToFind.includes(note);
  const isFretDisabled = isWholeNotesMode && !WHOLE_NOTES.includes(note);
  const isRevealed = !!(revealedFrets && revealedFrets[fretKey]);

  let dynamicClass = 'border-2 bg-slate-700 hover:bg-slate-600 border-transparent';
  if (fretIndex === 0) dynamicClass = 'bg-slate-400 border-2 border-transparent';

  if (!isInRange || isFretDisabled) {
    dynamicClass = 'bg-slate-800 opacity-40';
  } else if ((isReviewing || isPracticeMode) && isCorrectNote && !isFound) {
    dynamicClass = 'border-2 bg-purple-700 border-purple-500';
  } else if (isFlashing) {
    dynamicClass = 'border-2 bg-blue-500 border-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.9)]';
  } else if (isFound) {
    dynamicClass = 'bg-green-600 border-2 border-transparent';
  }

  const fretMarkers = () => {
    if (fretIndex === 0) return null;
    if ([3, 5, 7, 9].includes(fretIndex)) {
      return <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-blue-400 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.7)]"></div>
    }
    if (fretIndex === 12) {
      return (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center space-y-2 sm:space-y-3">
          <svg className="w-2.5 h-2.5 text-blue-400" fill="currentColor" viewBox="0 0 20 20"><path d="M10 0L20 10L10 20L0 10L10 0Z"/></svg>
          <svg className="w-2.5 h-2.5 text-blue-400" fill="currentColor" viewBox="0 0 20 20"><path d="M10 0L20 10L10 20L0 10L10 0Z"/></svg>
        </div>
      )
    }
    return null;
  }

  return (
    <div 
      onClick={() => handleFretClick(stringIndex, fretIndex)} 
      className={`relative w-full h-8 sm:h-10 rounded-sm cursor-pointer transition-all duration-200 ${dynamicClass} ${isShaking ? 'animate-[shake_0.3s_ease-in-out]' : ''}`}
    >
      {/* String line */}
      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-slate-500/50 pointer-events-none"></div>
      {/* Nut at fret 0 */}
      {fretIndex === 0 && <div className="absolute right-0 top-0 bottom-0 w-[6px] bg-slate-300 shadow-[inset_-2px_0_4px_rgba(0,0,0,0.4)] pointer-events-none"></div>}
      {fretMarkers()}
      {isRevealed && (
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800/90 border border-slate-600 shadow text-blue-300 animate-[fadeout_0.8s_linear_forwards]">
          {note}
        </div>
      )}
    </div>
  );
};

const FretRangeSelector = ({ type, fretRange, handleSetFretRange, fretColumns }) => {
  const isStart = type === 'start';
  const [start, end] = fretRange;
  
  const getButtonClass = (fretNum) => {
    const isSelectedAsStart = isStart && fretNum === start;
    const isSelectedAsEnd = !isStart && fretNum === end;
    const isInRange = fretNum >= start && fretNum <= end;

    if (isSelectedAsStart) {
      return 'bg-transparent border-2 border-green-500 text-green-400 shadow-[0_0_8px_theme(colors.green.500)]';
    }
    if (isSelectedAsEnd) {
      return 'bg-transparent border-2 border-blue-500 text-blue-400 shadow-[0_0_8px_theme(colors.blue.500)]';
    }
    if (isInRange) {
      return 'bg-transparent text-blue-400 drop-shadow-[0_0_3px_rgba(59,130,246,0.7)]';
    }
    return 'bg-transparent text-slate-500 hover:text-white';
  };

  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `2rem 2rem ${fretColumns}` }}>
      <div className="col-start-1 flex items-center justify-center font-bold text-xs text-slate-500">
        {isStart ? 'Start' : 'End'}
      </div>
      <div className="col-start-2">
        <button 
          onClick={() => handleSetFretRange(type, 0)}
          className={`flex items-center justify-center font-bold text-xs rounded-md py-1 w-full transition-all duration-200 ${getButtonClass(0)}`}
        >
          0
        </button>
      </div>
      <div className="col-start-3 col-span-12 grid gap-1" style={{ gridTemplateColumns: fretColumns }}>
        {Array.from({ length: 12 }, (_, i) => {
          const fretNum = i + 1;
          return (
            <button 
              key={`fret-num-${type}-${fretNum}`} 
              onClick={() => handleSetFretRange(type, fretNum)}
              className={`flex items-center justify-center font-bold text-xs rounded-md py-1 transition-all duration-200 ${getButtonClass(fretNum)}`}
            >
              {fretNum}
            </button>
          )
        })}
      </div>
    </div>
  );
};


const Fretboard = (props) => {
  const { fretboardLayout, tuning, progress, gameStarted, isPracticeMode } = props;

  // Compute realistic fret widths (shrinking up the neck)
  const fretColumns = React.useMemo(() => {
    const fretCount = (fretboardLayout?.[0]?.length || 1) - 1; // exclude open string
    return computeFretColumns(fretCount);
  }, [fretboardLayout]);
  
  const progressBarStyle = (gameStarted && !isPracticeMode) ? {
    backgroundImage: `linear-gradient(to right, #3b82f6 ${progress}%, #1e293b ${progress}%)`
  } : {};

  return (
    <div className="p-0.5 rounded-lg transition-all duration-200 bg-slate-800" style={progressBarStyle}>
      <div className="relative overflow-x-auto p-3 bg-slate-900 rounded-lg space-y-2">
        <FretRangeSelector type="start" {...props} fretColumns={fretColumns} />
        <div className="grid gap-1" style={{ gridTemplateColumns: `2rem 2rem ${fretColumns}` }}>
          <div className="col-start-1 grid gap-1" style={{gridTemplateRows: `repeat(${tuning.length}, minmax(0, 1fr))`}}>
            {tuning.map((stringName, i) => (
              <div key={`label-${i}`} className="flex items-center justify-center font-bold text-lg text-blue-400">{stringName}</div>
            ))}
          </div>
          <div className="col-start-2 grid gap-1" style={{gridTemplateRows: `repeat(${tuning.length}, minmax(0, 1fr))`}}>
            {fretboardLayout.map((string, stringIndex) => (
              <Fret {...props} key={getFretKey(stringIndex, 0)} stringIndex={stringIndex} fretIndex={0} note={string[0]} />
            ))}
          </div>
          <div className="col-start-3 col-span-12 grid gap-1" style={{gridTemplateColumns: fretColumns, gridTemplateRows: `repeat(${tuning.length}, minmax(0, 1fr))`}}>
            {fretboardLayout.map((string, stringIndex) => (
              <React.Fragment key={`string-${stringIndex}`}>
                {string.slice(1).map((note, fretIndex) => (
                  <Fret {...props} key={getFretKey(stringIndex, fretIndex + 1)} stringIndex={stringIndex} fretIndex={fretIndex + 1} note={note} />
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
        <FretRangeSelector type="end" {...props} fretColumns={fretColumns} />
      </div>
    </div>
  );
};

// --- Main App Component ---
function App() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const { gameStarted, isGameOver, isPracticeMode, isReviewing, timer, currentNote, notesToFind, message, foundFrets, flashFret, shakeFret, revealedFrets, totalNotesInRound, totalFretsFoundInRound } = state;
  
  // UI State
  const [instrument, setInstrument] = useState('Guitar');
  const [fretRange, setFretRange] = useState([0, 12]);
  const [gameMode, setGameMode] = useState('findNote');
  const [rootNote, setRootNote] = useState('C');
  const [scaleType, setScaleType] = useState('Major');
  const [isWholeNotesMode, setIsWholeNotesMode] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  const fretboardLayout = useMemo(() => {
    return generateFretboardLayout(INSTRUMENTS[instrument].tuning, INSTRUMENTS[instrument].frets);
    }, [instrument]);

  const progress = useMemo(() => {
    if (!gameStarted || totalNotesInRound === 0) return 0;
    return (totalFretsFoundInRound / totalNotesInRound) * 100;
  }, [gameStarted, totalNotesInRound, totalFretsFoundInRound]);

  const handleSetFretRange = (type, fretNum) => {
    const [start, end] = fretRange;
    if (type === 'start') {
      if (fretNum > end) setFretRange([fretNum, fretNum]);
      else setFretRange([fretNum, end]);
    } else {
      if (fretNum < start) setFretRange([fretNum, fretNum]);
      else setFretRange([start, fretNum]);
    }
  };

  const handleStartGame = async (isPractice = false) => {
    await audioEngine.init();
    setAudioReady(audioEngine.isInitialized);
    audioEngine.playStartSound();
    dispatch({ type: 'START_GAME', payload: { gameMode, fretRange, rootNote, scaleType, isWholeNotesMode, isPractice, fretboardLayout } });
  };

  const handleFretClick = async (stringIndex, fretIndex) => {
    await audioEngine.init();
    setAudioReady(audioEngine.isInitialized);
    if (!gameStarted || isReviewing || fretIndex < fretRange[0] || fretIndex > fretRange[1]) return;
    
    const clickedFretKey = getFretKey(stringIndex, fretIndex);
    const clickedNote = fretboardLayout[stringIndex][fretIndex];

    // Always reveal briefly on tap
    dispatch({ type: 'REVEAL_FRET', payload: { fretKey: clickedFretKey, note: clickedNote } });
    setTimeout(() => dispatch({ type: 'HIDE_REVEAL', payload: { fretKey: clickedFretKey } }), 800);
    
    if (isWholeNotesMode && !WHOLE_NOTES.includes(clickedNote)) return;

    if (notesToFind.includes(clickedNote)) {
      audioEngine.playCorrectSound({ stringIndex, fretIndex, instrument, note: clickedNote });
      dispatch({ type: 'CORRECT_GUESS', payload: { clickedFretKey } });
    } else {
      audioEngine.playIncorrectSound();
      dispatch({ type: 'FLASH_INCORRECT', payload: { clickedFretKey } });
      setTimeout(() => dispatch({ type: 'CLEAR_SHAKE' }), 300);
      dispatch({ type: 'INCORRECT_GUESS', payload: { gameMode } });
    }
  };
  
  useEffect(() => {
    if (flashFret) {
      const timer = setTimeout(() => dispatch({ type: 'CLEAR_FLASH' }), 200);
      return () => clearTimeout(timer);
    }
  }, [flashFret]);

  // --- Round Completion Logic ---
  useEffect(() => {
    if (!gameStarted) return;
    
    const allPositionsForCurrentNote = findAllNotePositions(notesToFind, fretRange, fretboardLayout);
    
    const isRoundComplete = allPositionsForCurrentNote.length > 0 && foundFrets.length === allPositionsForCurrentNote.length;

    if (isRoundComplete) {
      const timerId = setTimeout(() => {
        if (gameMode === 'findNote') {
          dispatch({ type: 'ADVANCE_NOTE' });
        } else { // scaleDrill
          dispatch({ type: 'GAME_OVER', payload: { finalTime: timer } });
        }
      }, 500);
      return () => clearTimeout(timerId);
    }
  }, [foundFrets, notesToFind, gameStarted, fretRange, gameMode, isPracticeMode, fretboardLayout]);

  // Handle review mode timeout
  useEffect(() => {
    if (isReviewing) {
      const timer = setTimeout(() => dispatch({ type: 'END_REVIEW' }), 2000);
      return () => clearTimeout(timer);
    }
  }, [isReviewing]);

  // --- Main Timer (requestAnimationFrame) ---
  useEffect(() => {
    let rafId;
    let lastTs = null;
    const tick = (ts) => {
      if (lastTs != null) {
        const dt = (ts - lastTs) / 1000;
        dispatch({ type: 'TICK_TIMER_DELTA', payload: dt });
      }
      lastTs = ts;
      rafId = requestAnimationFrame(tick);
    };
    if (gameStarted && !isGameOver && !isPracticeMode) {
      rafId = requestAnimationFrame(tick);
    }
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [gameStarted, isGameOver, isPracticeMode]);
  
  const buttonBaseStyle = "px-5 text-sm font-semibold transition-all duration-300 transform border-2 hover:scale-105 flex items-center justify-center";
  const playButtonStyle = `${buttonBaseStyle} bg-gradient-to-br from-slate-800 to-slate-900 border-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)] hover:shadow-[0_0_20px_rgba(59,130,246,0.7)] rounded-l-xl`;
  const stopButtonStyle = `${buttonBaseStyle} bg-gradient-to-br from-slate-800 to-slate-900 border-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.5)] hover:shadow-[0_0_20px_rgba(239,68,68,0.7)] rounded-l-xl`;
  const practiceButtonStyle = `${buttonBaseStyle} bg-gradient-to-br from-slate-800 to-slate-900 border-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.5)] hover:shadow-[0_0_20px_rgba(168,85,247,0.7)] rounded-r-xl`;
  const beepButtonStyle = `${buttonBaseStyle} bg-gradient-to-br from-slate-800 to-slate-900 border-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)] hover:shadow-[0_0_20px_rgba(16,185,129,0.7)] rounded-r-xl`;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700&display=swap');
        .font-orbitron { font-family: 'Orbitron', sans-serif; }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-2px)} 40%{transform:translateX(2px)} 60%{transform:translateX(-2px)} 80%{transform:translateX(2px)} }
        @keyframes fadeout { 0%{opacity:1} 100%{opacity:0} }
      `}</style>
      <div className="font-orbitron flex items-center justify-center min-h-screen bg-slate-900 text-slate-100 p-4">
        <div className="w-full max-w-5xl bg-slate-800/50 rounded-2xl shadow-2xl p-6 md:p-8 space-y-4 border border-slate-700">
          <Toolbar 
            instrument={instrument}
            setInstrument={setInstrument}
            gameMode={gameMode} setGameMode={setGameMode}
            rootNote={rootNote} setRootNote={setRootNote}
            scaleType={scaleType} setScaleType={setScaleType}
            isWholeNotesMode={isWholeNotesMode}
            setIsWholeNotesMode={setIsWholeNotesMode}
            gameStarted={gameStarted}
            audioReady={audioReady}
          />
          <div className="flex items-stretch justify-between bg-slate-900/70 rounded-xl shadow-lg border border-slate-700">
            <button onClick={gameStarted ? () => dispatch({ type: 'STOP_GAME' }) : () => handleStartGame(false)} className={gameStarted ? stopButtonStyle : playButtonStyle}>
              {gameStarted ? 'Stop' : 'Play'}
            </button>
            {!gameStarted && (
              <button onClick={async () => { await audioEngine.init(); setAudioReady(audioEngine.isInitialized); audioEngine.playNote('A4'); }} className={beepButtonStyle}>
                Test Beep
              </button>
            )}
            <div className="flex items-center space-x-3 pl-6">
              <p className="text-sm font-semibold text-slate-400 tracking-wider uppercase">
                {gameMode === 'findNote' ? 'Note:' : 'Scale:'}
              </p>
              <p className="text-3xl font-bold text-blue-400">
                {gameMode === 'findNote' ? (currentNote || '?') : `${rootNote} ${scaleType}`}
              </p>
            </div>

            <div className="flex-1 text-center px-4 flex items-center justify-center">
              <p className={`font-semibold text-sm ${message.startsWith('Correct') || message.includes('complete') || message.includes('Finished') ? 'text-green-400' : message.includes('Not quite') || message.includes('Whoops') ? 'text-red-400' : 'text-slate-300'}`}>{message}</p>
            </div>
            
            <div className="flex items-center pr-4">
              {!isPracticeMode && (isGameOver ? <FinalTimeDisplay time={timer} /> : <TimerDisplay time={timer} />)}
            </div>
            {!gameStarted && 
              <button onClick={() => handleStartGame(true)} className={practiceButtonStyle}>
                Practice
              </button>
            }
          </div>
          
          <Fretboard 
            handleFretClick={handleFretClick} 
            foundFrets={foundFrets} 
            flashFret={flashFret} 
            shakeFret={shakeFret}
            revealedFrets={revealedFrets}
            fretRange={fretRange} 
            handleSetFretRange={handleSetFretRange}
            isReviewing={isReviewing}
            isPracticeMode={isPracticeMode}
            notesToFind={notesToFind}
            isWholeNotesMode={isWholeNotesMode}
            fretboardLayout={fretboardLayout}
            tuning={INSTRUMENTS[instrument].tuning}
            progress={progress}
            gameStarted={gameStarted}
          />
        </div>
      </div>
    </>
  );
}

// --- Dev: Lightweight reducer tests (console assertions) ---
const __RUN_DEV_TESTS__ = true;
if (__RUN_DEV_TESTS__) {
  (function runReducerTests() {
    try {
      // 1) Timer delta increments when game is started
      let st = { ...initialState, gameStarted: true };
      st = gameReducer(st, { type: 'TICK_TIMER_DELTA', payload: 1.0 });
      console.assert(Math.abs(st.timer - 1) < 1e-6, 'TICK_TIMER_DELTA should add delta seconds');

      // 2) STOP_GAME clears gameStarted
      const afterStop = gameReducer(st, { type: 'STOP_GAME' });
      console.assert(afterStop.gameStarted === false, 'STOP_GAME should stop game');

      // 3) Reveal/hide
      let s2 = gameReducer(initialState, { type: 'REVEAL_FRET', payload: { fretKey: '0-0', note: 'E' } });
      console.assert(s2.revealedFrets['0-0'] === 'E', 'REVEAL_FRET stores note');
      s2 = gameReducer(s2, { type: 'HIDE_REVEAL', payload: { fretKey: '0-0' } });
      console.assert(!('0-0' in s2.revealedFrets), 'HIDE_REVEAL removes note');

      // 4) Timer shouldn't advance when game not started
      let s3 = { ...initialState, gameStarted: false };
      s3 = gameReducer(s3, { type: 'TICK_TIMER_DELTA', payload: 0.5 });
      console.assert(s3.timer === 0, 'Timer does not advance when game not started');

      // 5) computeFretColumns produces correct segment count
      const cols = computeFretColumns(12);
      console.assert(cols.split(' ').length === 12, 'computeFretColumns should return 12 segments for 12 frets');

      // 6) findAllNotePositions sanity check on a single-string board
      const fb = generateFretboardLayout(['C'], 13); // C, then 12 semitones
      const pos = findAllNotePositions(['E'], [0, 12], fb);
      console.assert(Array.isArray(pos) && pos.includes('0-4') && pos.length === 1, 'E on C string should be only at fret 4 within 0-12');

      // 7) Practice mode: timer does not advance
      let s4 = { ...initialState, gameStarted: true, isPracticeMode: true };
      s4 = gameReducer(s4, { type: 'TICK_TIMER_DELTA', payload: 1 });
      console.assert(s4.timer === 0, 'Timer must not advance in practice mode');

      // 8) String/fret to MIDI mapping (high E on top)
      console.assert(computeStringFretMidi('Guitar', 0, 0) === 64, 'Top string open should be E4 (64)');
      console.assert(computeStringFretMidi('Guitar', 5, 0) === 40, 'Bottom string open should be E2 (40)');
      console.assert(computeStringFretMidi('Guitar', 0, 1) === 65, 'Top string fret 1 should be F4 (65)');

      // 9) Bass mapping sanity
      console.assert(computeStringFretMidi('Bass', 0, 0) === 43, 'Bass top string open should be G2 (43)');
      console.assert(computeStringFretMidi('Bass', 3, 5) === 28 + 5, 'Bass low E1 plus 5 frets should be 33');
    } catch (e) {
      console.warn('Reducer tests encountered an error:', e);
    }
  })();
}

export default App;
