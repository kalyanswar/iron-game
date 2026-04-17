const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- UI Elements ---
const hud = document.getElementById('hud');
const energyFill = document.getElementById('energy-fill');
const feScoreEl = document.getElementById('fe-score');
const actionTooltip = document.getElementById('action-tooltip');

const titleScreen = document.getElementById('title-screen');
const levelCompleteScreen = document.getElementById('level-complete-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const victoryScreen = document.getElementById('victory-screen');
const levelStats = document.getElementById('level-stats');

const star1 = document.getElementById('star-1');
const star2 = document.getElementById('star-2');
const star3 = document.getElementById('star-3');
const levelOrbsStats = document.getElementById('level-orbs-stats');
const totalOrbsStats = document.getElementById('total-orbs-stats');
const finalRankEl = document.getElementById('final-rank');

const dialogueBox = document.getElementById('dialogue-box');
const dialoguePortrait = document.getElementById('dialogue-portrait');
const dialogueName = document.getElementById('dialogue-name');
const dialogueText = document.getElementById('dialogue-text');

const btnStart = document.getElementById('btn-start');
const btnNextLevel = document.getElementById('btn-next-level');
const btnRestart = document.getElementById('btn-restart');
const btnPlayAgain = document.getElementById('btn-play-again');
const mobileControls = document.getElementById('mobile-controls');

// --- Sound Engine (Web Audio API Synthesis) ---
const SoundEngine = {
    ctx: null,
    init: function() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    playTone: function(type, freq, duration, slideFreq = null) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        if (slideFreq) osc.frequency.exponentialRampToValueAtTime(slideFreq, this.ctx.currentTime + duration);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    jump: () => SoundEngine.playTone('sine', 300, 0.2, 800),
    doubleJump: () => SoundEngine.playTone('sine', 500, 0.2, 1000),
    orb: () => SoundEngine.playTone('square', 800, 0.1, 1200),
    powerup: () => SoundEngine.playTone('triangle', 300, 0.5, 900),
    hurt: () => SoundEngine.playTone('sawtooth', 150, 0.3, 50),
    smash: () => SoundEngine.playTone('square', 200, 0.1, 100),
    blip: () => SoundEngine.playTone('square', 600, 0.05)
};

// --- Game State ---
let gameState = 'title'; // title, playing, dialogue, level_complete, game_over, victory
let currentLevelIndex = 0;
let cameraX = 0;
let cameraY = 0;
let feScore = 0;
let ironEnergy = 100;

// Tracking System additions
let levelFeScore = 0;
let totalPossibleOrbs = 0;

// Dialogue State
let currentDialogueSequence = null;
let currentDialogueLineIndex = 0;

// --- Physics Constants ---
const GRAVITY = 1.35;
const MAX_FALL_SPEED = 18;

// --- Input Handling ---
const keys = { right: false, left: false, up: false };

window.addEventListener('keydown', (e) => {
    if (gameState === 'playing') {
        if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
            if (!keys.up) handleJump();
            keys.up = true;
        }
    } else if (gameState === 'dialogue') {
        if (e.code === 'Space') advanceDialogue();
    }
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = false;
});

// Mobile Controls
document.getElementById('btn-jump').addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    SoundEngine.init(); 
    handleJump(); 
});

function handleJoystickEvent(e) {
    const touch = e.touches[0];
    const rect = e.target.getBoundingClientRect();
    if(touch.clientX > rect.left + rect.width/2) {
        keys.right = true; keys.left = false;
    } else {
        keys.left = true; keys.right = false;
    }
}

document.getElementById('joystick-zone').addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleJoystickEvent(e);
});
document.getElementById('joystick-zone').addEventListener('touchmove', (e) => {
    e.preventDefault();
    handleJoystickEvent(e);
});
document.getElementById('joystick-zone').addEventListener('touchend', () => { keys.right = false; keys.left = false; });
dialogueBox.addEventListener('click', () => { if (gameState === 'dialogue') advanceDialogue(); });

// --- Sprite Processing ---
let rawSprite = new Image();
let playerCanvas = document.createElement('canvas'); 
let pctx = playerCanvas.getContext('2d');
let spriteLoaded = false;

rawSprite.onload = () => {
    playerCanvas.width = rawSprite.width;
    playerCanvas.height = rawSprite.height;
    pctx.drawImage(rawSprite, 0, 0);
    
    let imgData = pctx.getImageData(0, 0, playerCanvas.width, playerCanvas.height);
    let data = imgData.data;
    for(let i=0; i < data.length; i+=4) {
        let r = data[i], g = data[i+1], b = data[i+2];
        if(r > 240 && g > 240 && b > 240) {
            data[i+3] = 0; 
        }
    }
    pctx.putImageData(imgData, 0, 0);
    spriteLoaded = true;
};
rawSprite.src = 'player_sprite.png';


// --- Entities Data Structs ---
let platforms = [];
let orbs = [];
let items = [];
let enemies = [];
let dialogues = [];
let endGoal = null;

const player = {
    x: 100, y: 100, width: 72, height: 72,
    vx: 0, vy: 0,
    speed: 7.5, jumpForce: -18,
    grounded: false, coyoteTimer: 0, maxCoyoteTime: 8,
    hasDoubleJump: false, canDoubleJump: false,
    facingRight: true,
    auraRadius: 0
};

// --- Character Portraits Library ---
const PORTRAITS = {
    dr_cee: { image: 'url("portrait_dr_cee.png")', color: '#ffde59', name: "Dr. Cee" },
    sugar_king: { image: 'url("portrait_sugar_king.png")', color: '#f36fb5', name: "Sugar King" },
    anaemia: { image: 'none', background: '#300b45', color: '#888', name: "Anaemia Shadow" },
    ferro: { image: 'url("player_sprite.png")', color: '#ff416c', name: "Ferro" }
};

// --- Level Design Data (6 Worlds Rebalanced) ---
const levels = [
    // --- LEVEL 1: JUNK FOOD JUNGLE ---
    {
        startPos: {x: 100, y: 100},
        minY: null, 
        deathY: 800,
        platforms: [
            {x: 0, y: 400, w: 900, h: 50, color: '#d9a05b'}, 
            {x: 1050, y: 400, w: 500, h: 50, color: '#d9a05b'}, 
            {x: 1650, y: 320, w: 100, h: 20, color: '#f36fb5'}, 
            {x: 1850, y: 250, w: 100, h: 20, color: '#f36fb5'},
            {x: 2100, y: 350, w: 600, h: 50, color: '#d9a05b'},
            {x: 2800, y: 400, w: 1000, h: 50, color: '#d9a05b'} 
        ],
        orbs: [
            {x: 500, y: 350}, {x: 550, y: 350}, {x: 600, y: 350},
            {x: 950, y: 250}, {x: 1000, y: 220}, {x: 1050, y: 250},
            {x: 2300, y: 300}, {x: 2350, y: 300}
        ],
        items: [
            {x: 2200, y: 300, type: 'spinach'}
        ],
        enemies: [
            {type: 'slime', x: 1200, y: 360, w: 60, h: 40, vx: 2.25, minX: 1100, maxX: 1500}
        ],
        dialogues: [
            {
                triggerX: 200, active: true,
                lines: [
                    { char: 'dr_cee', text: "Whoa there! You're moving a bit slow today. Notice how everything looks pale?" },
                    { char: 'ferro', text: "I just ate a ton of candy, though! Shouldn't I be fast?" },
                    { char: 'dr_cee', text: "Candy gives a quick zap of sugar energy, but leaves you crashing! Real energy requires Iron!" }
                ]
            },
            {
                triggerX: 3000, active: true,
                lines: [
                    { char: 'sugar_king', text: "Grr! Stop eating greens! I am the Sugar King!" },
                    { char: 'dr_cee', text: "He's all exhausted from a sugar crash! Quickly, run to the goal!" }
                ]
            }
        ],
        endGoal: {x: 3600, y: 300, w: 50, h: 100}
    },

    // --- LEVEL 2: IRON GARDEN (VERTICAL!) ---
    {
        startPos: {x: 100, y: 800},
        deathY: 1500,
        platforms: [
            {x: 0, y: 900, w: 900, h: 50, color: '#4caf50'}, 
            {x: 600, y: 750, w: 150, h: 20, color: '#8bc34a'},
            {x: 200, y: 600, w: 150, h: 20, color: '#8bc34a'},
            {x: 450, y: 450, w: 150, h: 20, color: '#8bc34a'},
            {x: 100, y: 300, w: 150, h: 20, color: '#8bc34a'},
            {x: 500, y: 150, w: 150, h: 20, color: '#8bc34a'},
            {x: 200, y: 0, w: 500, h: 50, color: '#4caf50'},
            {x: 100, y: -150, w: 150, h: 20, color: '#8bc34a'},
            {x: 600, y: -300, w: 150, h: 20, color: '#8bc34a'},
            {x: 300, y: -450, w: 150, h: 20, color: '#8bc34a'},
            {x: 100, y: -600, w: 800, h: 50, color: '#4caf50'} 
        ],
        orbs: [
            {x: 650, y: 680}, {x: 250, y: 530}, {x: 500, y: 380}, {x: 150, y: 230},
            {x: 250, y: -50}, {x: 450, y: -50}, {x: 650, y: -350}
        ],
        items: [
            {x: 650, y: 720, type: 'spinach'},
            {x: 450, y: -50, type: 'spinach'} 
        ],
        enemies: [],
        dialogues: [
            {
                triggerX: 200, active: true,
                lines: [
                    { char: 'dr_cee', text: "Welcome to the Iron Garden! See how vibrant it is?" },
                    { char: 'dr_cee', text: "Climbing this high takes a lot of stamina. Beans, lentils, and dark leafy greens grow here!" }
                ]
            }
        ],
        endGoal: {x: 750, y: -700, w: 50, h: 100}
    },

    // --- LEVEL 3: FOG OF FATIGUE (Fixing floating goalpost & bats) ---
    (function() {
        let level = { startPos: {x: 100, y: 300}, deathY: 800, platforms: [], orbs: [], items: [], enemies: [], dialogues: [], endGoal: {x: 4500, y: 300, w: 50, h: 100} };
        
        // Solid continuous ground with small gaps
        for(let i=0; i<=4200; i+=600) {
            level.platforms.push({x: i, y: 400, w: 450, h: 50, color: '#789'});
            level.enemies.push({type: 'slime', x: i+200, y: 360, w: 60, h: 40, vx: 3, minX: i+50, maxX: i+400});
            level.enemies.push({type: 'bat', x: i+500, y: 200, startY: 200, w: 40, h: 20});
            level.orbs.push({x: i+300, y: 350});
        }
        
        level.platforms.push({x: 4400, y: 400, w: 400, h: 50, color: '#789'}); // Safely catch the player
        level.items.push({x: 1000, y: 350, type: 'spinach'}, {x: 2500, y: 350, type: 'spinach'}, {x: 3500, y: 350, type: 'spinach'});
        level.dialogues.push({ triggerX: 200, active: true, lines: [{char: 'dr_cee', text: "Be careful! The Fog of Fatigue introduces Junk Food Bats!"}, {char: 'dr_cee', text: "They hover up and down to block your aerial paths!"}]});
        return level;
    })(),

    // --- LEVEL 4: VITAMIN C VALLEY (Spikes and Slimes) ---
    (function() {
        let level = { startPos: {x: 100, y: 300}, deathY: 800, platforms: [{x:0, y:400, w:400, h:50, color:'#ffb74d'}], orbs: [], items: [], enemies: [], dialogues: [], endGoal: {x: 4050, y: 300, w: 50, h: 100} };
        
        let curX = 400;
        for(let i=0; i<6; i++) {
            let gap = 150; 
            let platW = 400;
            curX += gap;
            level.platforms.push({x: curX, y: 400, w: platW, h: 50, color: '#ffb74d'});
            
            level.enemies.push({type: 'spike', x: curX + platW/2, y: 360, w: 40, h: 40});
            level.enemies.push({type: 'bat', x: curX + 50, y: 250, startY: 250, w: 40, h: 20});
            
            level.orbs.push({x: curX + 100, y: 300});
            level.items.push({x: curX + platW - 50, y: 350, type: 'spinach'});
            curX += platW;
        }

        // Secure Goal aligns correctly with the end of the loop
        level.platforms.push({x: curX + 150, y: 400, w: 400, h: 50, color: '#ffb74d'});
        
        level.dialogues.push({ triggerX: 200, active: true, lines: [{char: 'dr_cee', text: "Watch your step! Candy Spikes are static hazards. You cannot destroy them!"}, {char: 'dr_cee', text: "You must carefully time your jumps around them!"}]});
        return level;
    })(),

    // --- LEVEL 5: BLOOD RIVER PASS ---
    (function() {
        let level = { startPos: {x: 100, y: 300}, deathY: 900, platforms: [{x:0, y:400, w:400, h:50, color:'#d32f2f'}], orbs: [], items: [], enemies: [], dialogues: [], endGoal: {x: 5000, y: 300, w: 50, h: 100} };
        
        for(let i=500; i<4500; i+= 400) {
            // Larger safe islands instead of tiny hell stones
            level.platforms.push({x: i, y: 450 + Math.sin(i)*50, w: 200, h: 30, color: '#e53935'});
            
            // Randomly populate with a slime OR a spike
            if (i % 800 === 0) {
                 level.enemies.push({type: 'spike', x: i + 80, y: 410 + Math.sin(i)*50, w: 40, h: 40});
            } else {
                 level.enemies.push({type: 'slime', x: i + 50, y: 410 + Math.sin(i)*50, w: 60, h: 40, vx: 1.5, minX: i, maxX: i+150});
            }

            if(i % 1200 === 0) level.items.push({x: i+50, y: 350, type: 'spinach'});
            level.orbs.push({x: i+100, y: 350});
        }
        // Base goal
        level.platforms.push({x: 4800, y: 400, w: 500, h: 50, color: '#d32f2f'});

        level.dialogues.push({ triggerX: 200, active: true, lines: [{char: 'dr_cee', text: "The Blood River Pass. This is much more manageable!"}, {char: 'dr_cee', text: "Hop carefully across the islands and don't trip on the Spikes!"}]});
        return level;
    })(),

    // --- LEVEL 6: CLINIC OF HOPE (THE GAUNTLET) ---
    (function() {
        let level = { startPos: {x: 100, y: 300}, deathY: 800, platforms: [{x:0, y:400, w:5500, h:50, color:'#cfd8dc'}], orbs: [], items: [], enemies: [], dialogues: [], endGoal: {x: 5200, y: 300, w: 50, h: 100} };
        
        // Massive Gauntlet Generator (Slimes, Bats, and Spikes all at once!)
        for(let i=600; i<4800; i+= 300) {
            // Slime layer
            level.enemies.push({type: 'slime', x: i, y: 360, w: 60, h: 40, vx: (Math.random() > 0.5 ? 3 : -3), minX: i-100, maxX: i+100});
            // Bat layer hovering high
            level.enemies.push({type: 'bat', x: i+150, y: 200, startY: 200, w: 40, h: 20});
            // Occasional Spike wall
            if (i % 900 === 0) {
               level.enemies.push({type: 'spike', x: i+200, y: 360, w: 40, h: 40});
            }

            if(i % 1200 === 0) level.items.push({x: i, y: 250, type: 'spinach'}); 
        }

        level.dialogues.push({ triggerX: 200, active: true, lines: [{char: 'dr_cee', text: "THE FINAL GAUNTLET! The Anaemia boss has summoned everything!"}, {char: 'dr_cee', text: "Slimes, bats, spikes... use every skill you've learned to smash through!"}]});
        level.dialogues.push({ triggerX: 4700, active: true, lines: [
            {char: 'anaemia', text: "Impossible... you breached my army..."}, 
            {char: 'ferro', text: "My Iron is fully stocked! Your shadows can't touch me!"}, 
            {char: 'dr_cee', text: "Finish it! Grab the final flag to purge Anaemia!"}
        ]});
        return level;
    })()
];

function loadLevel(index) {
    if (index >= levels.length) {
        changeState('victory');
        return;
    }
    const data = levels[index];
    currentLevelIndex = index;
    levelFeScore = 0;
    
    if (index === 0 && totalPossibleOrbs === 0) {
        levels.forEach(l => { totalPossibleOrbs += l.orbs.length; });
    }
    
    // Reset player
    player.x = data.startPos.x;
    player.y = data.startPos.y;
    player.vx = 0; player.vy = 0;
    ironEnergy = 80; // Start higher so players have more time
    
    // Initialize Camera
    cameraX = player.x - canvas.width / 2;
    cameraY = player.y - canvas.height / 2; 

    // Load data
    platforms = [...data.platforms];
    orbs = data.orbs.map(o => ({x: o.x, y: o.y, r: 12, active: true, pulse: Math.random() * Math.PI}));
    items = data.items.map(i => ({x: i.x, y: i.y, w: 30, h: 30, type: i.type, active: true}));
    
    // Load Enemies mapping types deeply
    enemies = data.enemies.map(e => ({
        type: e.type, x: e.x, y: e.y, startY: e.startY, w: e.w, h: e.h, vx: e.vx, minX: e.minX, maxX: e.maxX, active: true
    }));

    // Deep copy dialogues
    dialogues = data.dialogues.map(d => ({
        triggerX: d.triggerX, active: d.active, lines: [...d.lines]
    }));

    endGoal = {...data.endGoal};

    changeState('playing');
}

// --- State Management ---
function changeState(newState) {
    gameState = newState;
    titleScreen.classList.add('hidden');
    levelCompleteScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    victoryScreen.classList.add('hidden');
    hud.classList.add('hidden');
    dialogueBox.classList.add('hidden');
    mobileControls.classList.add('hidden');

    if (newState === 'title') {
        titleScreen.classList.remove('hidden');
        feScore = 0;
        feScoreEl.innerText = feScore;
    } else if (newState === 'playing') {
        hud.classList.remove('hidden');
        mobileControls.classList.remove('hidden');
    } else if (newState === 'dialogue') {
        hud.classList.remove('hidden');
        dialogueBox.classList.remove('hidden');
        keys.left = false; keys.right = false; keys.up = false;
        player.vx = 0; 
    } else if (newState === 'level_complete') {
        levelStats.innerText = `Iron Maintained: ${Math.floor(ironEnergy)}%`;
        levelOrbsStats.innerText = `Orbs Collected: ${levelFeScore}`;
        
        star1.classList.remove('active');
        star2.classList.remove('active');
        star3.classList.remove('active');
        
        // Force reflow to restart CSS animations reliably
        void star1.offsetWidth; 
        
        if (ironEnergy > 0) star1.classList.add('active'); 
        if (ironEnergy >= 40) star2.classList.add('active'); 
        if (ironEnergy >= 80) star3.classList.add('active'); 

        levelCompleteScreen.classList.remove('hidden');
    } else if (newState === 'game_over') {
        gameOverScreen.classList.remove('hidden');
    } else if (newState === 'victory') {
        totalOrbsStats.innerText = `Total Orbs: ${feScore} / ${totalPossibleOrbs}`;
        
        let ratio = totalPossibleOrbs > 0 ? (feScore / totalPossibleOrbs) : 1;
        let finalChar = 'C';
        let rankClass = 'rank-c';
        
        if (ratio >= 0.9) { finalChar = 'S'; rankClass = 'rank-s'; }
        else if (ratio >= 0.7) { finalChar = 'A'; rankClass = 'rank-a'; }
        else if (ratio >= 0.4) { finalChar = 'B'; rankClass = 'rank-b'; }

        finalRankEl.innerText = finalChar;
        finalRankEl.className = rankClass;

        victoryScreen.classList.remove('hidden');
    }
}

// --- Dialogue Logic ---
function startDialogue(dialogueObj) {
    dialogueObj.active = false; 
    currentDialogueSequence = dialogueObj;
    currentDialogueLineIndex = 0;
    renderDialogueLine();
    changeState('dialogue');
}

function renderDialogueLine() {
    const line = currentDialogueSequence.lines[currentDialogueLineIndex];
    const portraitData = PORTRAITS[line.char];
    
    dialogueName.innerText = portraitData.name;
    dialogueName.style.color = portraitData.color;
    dialogueText.innerText = line.text;
    
    if (portraitData.image === 'none') {
        dialoguePortrait.style.backgroundImage = 'none';
        dialoguePortrait.style.backgroundColor = portraitData.background;
    } else {
        dialoguePortrait.style.backgroundImage = portraitData.image;
        dialoguePortrait.style.backgroundColor = '#222';
    }
}

function advanceDialogue() {
    SoundEngine.blip();
    currentDialogueLineIndex++;
    if (currentDialogueLineIndex >= currentDialogueSequence.lines.length) {
        changeState('playing'); 
    } else {
        renderDialogueLine();
    }
}


function handleJump() {
    if (gameState !== 'playing') return;
    if (player.grounded || player.coyoteTimer > 0) {
        player.vy = player.jumpForce;
        player.grounded = false;
        player.coyoteTimer = 0;
        player.canDoubleJump = player.hasDoubleJump;
        SoundEngine.jump();
    } else if (player.canDoubleJump) {
        player.vy = player.jumpForce * 0.9;
        player.canDoubleJump = false;
        triggerTooltip("Double Jump!");
        SoundEngine.doubleJump();
    }
}

function updateIronMechanic() {
    ironEnergy -= 0.06; 
    if (ironEnergy < 0) ironEnergy = 0;
    
    energyFill.style.width = ironEnergy + '%';
    
    if (ironEnergy < 30) {
        player.speed = 6; player.jumpForce = -16.5;
        energyFill.style.background = '#888';
        player.hasDoubleJump = false;
    } else if (ironEnergy < 80) {
        player.speed = 7.5; player.jumpForce = -18;
        energyFill.style.background = 'linear-gradient(90deg, #ff416c, #ff4b2b)';
        player.hasDoubleJump = false;
    } else {
        player.speed = 10.5; player.jumpForce = -21.75;
        energyFill.style.background = '#ffeb3b';
        player.hasDoubleJump = true;
        player.auraRadius = Math.sin(Date.now() / 66) * 8 + 15;
    }

    if (ironEnergy === 0) changeState('game_over');
}

function updatePhysics() {
    if (keys.right) { player.vx = player.speed; player.facingRight = true; }
    else if (keys.left) { player.vx = -player.speed; player.facingRight = false; }
    else player.vx = 0;

    player.x += player.vx;

    player.vy += GRAVITY;
    if (player.vy > MAX_FALL_SPEED) player.vy = MAX_FALL_SPEED;
    player.y += player.vy;

    // HORIZONTAL CAMERA TRACKING
    if (player.x - cameraX > canvas.width * 0.6) cameraX = player.x - canvas.width * 0.6;
    if (player.x - cameraX < canvas.width * 0.25) cameraX = player.x - canvas.width * 0.25;
    if (cameraX < levels[currentLevelIndex].startPos.x - canvas.width * 0.375) {
        cameraX = levels[currentLevelIndex].startPos.x - canvas.width * 0.375;
    }

    // VERTICAL CAMERA TRACKING
    if (player.y - cameraY > canvas.height * 0.55) cameraY = player.y - canvas.height * 0.55;
    if (player.y - cameraY < canvas.height * 0.33) cameraY = player.y - canvas.height * 0.33;

    // Platform Collisions
    player.grounded = false;
    for (let p of platforms) {
        if (player.x < p.x + p.w && player.x + player.width > p.x &&
            player.y + player.height > p.y && player.y < p.y + p.h) {
            
            // Only stand on top if falling onto it
            if (player.vy > 0 && player.y + player.height - player.vy <= p.y + 12) {
                player.grounded = true;
                player.vy = 0;
                player.y = p.y - player.height;
                player.coyoteTimer = player.maxCoyoteTime;
            }
        }
    }

    // Dynamic Death Pit
    if (player.y > levels[currentLevelIndex].deathY) {
        SoundEngine.hurt();
        triggerTooltip("Oops! Level Restarted.");
        loadLevel(currentLevelIndex);
    }
}

function updateEntities() {
    for (let d of dialogues) {
        if (d.active && player.x >= d.triggerX) {
            startDialogue(d);
            return;
        }
    }

    // Orbs
    for (let orb of orbs) {
        if (!orb.active) continue;
        orb.pulse += 0.1;
        
        let dx = (player.x + player.width/2) - orb.x;
        let dy = (player.y + player.height/2) - orb.y;
        if (Math.sqrt(dx*dx + dy*dy) < orb.r + player.width/2) {
            orb.active = false;
            feScore++;
            levelFeScore++;
            feScoreEl.innerText = feScore;
            ironEnergy = Math.min(100, ironEnergy + 15);
            SoundEngine.orb();
        }
    }

    // Items
    for (let item of items) {
        if (!item.active) continue;
        if (player.x < item.x + item.w && player.x + player.width > item.x &&
            player.y + player.height > item.y && player.y < item.y + item.h) {
            item.active = false;
            ironEnergy = 100; 
            triggerTooltip("Spinach! Double Jump Unlocked!");
            SoundEngine.powerup();
        }
    }

    // Enemies (Polymorphic Updates!)
    for (let e of enemies) {
        if (!e.active) continue;
        
        // MOVEMENT LOGIC
        if (e.type === 'slime') {
            e.x += e.vx;
            if (e.x < e.minX || e.x > e.maxX) e.vx *= -1; 
        } else if (e.type === 'bat') {
            // Hover up and down endlessly based on time
            e.y = e.startY + Math.sin(Date.now() / 133 + e.x) * 50; 
        }
        // e.type === 'spike' does nothing (static)

        // COLLISION LOGIC
        if (player.x < e.x + e.w && player.x + player.width > e.x &&
            player.y + player.height > e.y && player.y < e.y + e.h) {
            
            if (e.type === 'spike') {
                ironEnergy -= 20; 
                player.vy = -12;
                player.vx = (player.x < e.x) ? -15 : 15;
                player.x += player.vx;
                triggerTooltip("Ouch! Candy Spikes!");
                SoundEngine.hurt();
            } else {
                // Killable enemies
                if (ironEnergy >= 80) {
                    e.active = false;
                    triggerTooltip("Smashed the Enemy!");
                    player.vy = -12;
                    SoundEngine.smash();
                } else {
                    ironEnergy -= 30; // Fair penalty
                    player.vy = -9;
                    player.vx = (player.x < e.x) ? -22.5 : 22.5;
                    player.x += player.vx;
                    e.active = false; 
                    triggerTooltip("Drained Energy!");
                    SoundEngine.hurt();
                }
            }
        }
    }

    // End Goal Collision
    if (endGoal && player.x < endGoal.x + endGoal.w && player.x + player.width > endGoal.x &&
        player.y + player.height > endGoal.y && player.y < endGoal.y + endGoal.h) {
        changeState('level_complete');
    }
}

function triggerTooltip(text) {
    actionTooltip.innerText = text;
    actionTooltip.classList.add('show');
    setTimeout(() => { actionTooltip.classList.remove('show'); }, 2000);
}

// --- Rendering ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); 

    ctx.save();
    // APPLY BOTH X AND Y CAMERA TRANSLATION
    ctx.translate(-Math.floor(cameraX), -Math.floor(cameraY));

    // Platforms
    for (let p of platforms) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(p.x, p.y, p.w, 4);
    }

    // End Goal
    if (endGoal) {
        let gradient = ctx.createLinearGradient(0, endGoal.y, 0, endGoal.y + endGoal.h);
        gradient.addColorStop(0, "white");
        gradient.addColorStop(1, "gold");
        ctx.fillStyle = gradient;
        ctx.fillRect(endGoal.x, endGoal.y, endGoal.w, endGoal.h);
    }

    // Orbs
    for (let orb of orbs) {
        if (!orb.active) continue;
        ctx.fillStyle = '#ffde59';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.r + Math.sin(orb.pulse) * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff914d';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.r/2, 0, Math.PI * 2);
        ctx.fill();
    }

    // Items
    for (let item of items) {
        if (!item.active) continue;
        if (item.type === 'spinach') {
            ctx.fillStyle = '#00E676';
            ctx.fillRect(item.x, item.y, item.w, item.h);
            ctx.fillStyle = '#fff';
            ctx.font = "bold 12px Arial";
            ctx.fillText("SP", item.x + 5, item.y + 20);
        }
    }

    // Enemies (Polymorphic Drawing!)
    for (let e of enemies) {
        if (!e.active) continue;
        
        if (e.type === 'spike') {
            ctx.fillStyle = '#f36fb5';
            ctx.beginPath();
            ctx.moveTo(e.x + e.w/2, e.y); // Spike tip
            ctx.lineTo(e.x + e.w, e.y + e.h); // Base right
            ctx.lineTo(e.x, e.y + e.h); // Base left
            ctx.closePath();
            ctx.fill();
        } else if (e.type === 'bat') {
            ctx.fillStyle = '#00acc1'; 
            ctx.beginPath();
            ctx.ellipse(e.x + e.w/2, e.y + e.h/2, e.w/2, e.h/4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'red';
            ctx.fillRect(e.x + e.w/2 - 5, e.y + e.h/2 - 2, 4, 4); // Eyes
        } else {
            // Slime
            ctx.fillStyle = '#837'; 
            ctx.beginPath();
            ctx.ellipse(e.x + e.w/2, e.y + e.h, e.w/2, e.h/2 * Math.abs(Math.sin(Date.now()/200)) + 10, 0, 0, Math.PI, true);
            ctx.fill();
            ctx.fillStyle = 'red';
            ctx.fillRect(e.x + (e.vx > 0 ? e.w-20 : 10), e.y + e.h/2, 5, 5);
        }
    }

    // Player
    if (ironEnergy >= 80) {
        ctx.shadowColor = '#ffeb3b';
        ctx.shadowBlur = player.auraRadius;
    } else {
        ctx.shadowBlur = 0;
    }

    if (ironEnergy < 30) {
        ctx.filter = 'grayscale(100%)';
    } else {
        ctx.filter = 'none';
    }

    if (spriteLoaded) {
        ctx.save();
        if (!player.facingRight) {
            ctx.translate(player.x + player.width, player.y);
            ctx.scale(-1, 1);
            ctx.drawImage(playerCanvas, 0, 0, player.width, player.height);
        } else {
            ctx.drawImage(playerCanvas, player.x, player.y, player.width, player.height);
        }
        ctx.restore();
    } else {
        ctx.fillStyle = '#ff4b2b';
        ctx.fillRect(Math.floor(player.x), Math.floor(player.y), player.width, player.height);
    }

    ctx.restore();

    // UI overlays that are drawn on canvas directly (dimming during dialogue)
    if (gameState === 'dialogue') {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height); 
    }
}

// --- Main Loop ---
let lastTime = 0;
const fps = 60;
const fpsInterval = 1000 / fps;

function loop(currentTime) {
    requestAnimationFrame(loop);
    
    if (lastTime === 0) {
        lastTime = currentTime;
    }
    
    const elapsed = currentTime - lastTime;
    if (elapsed > fpsInterval) {
        lastTime = currentTime - (elapsed % fpsInterval);

        if (gameState === 'playing' || gameState === 'dialogue') {
            if (gameState === 'playing') {
                updateIronMechanic();
                if (!player.grounded) player.coyoteTimer--;
                updatePhysics();
                updateEntities();
            }
            draw();
        }
    }
}

// --- Button Hooks ---
btnStart.addEventListener('click', () => { SoundEngine.init(); loadLevel(0); });
btnNextLevel.addEventListener('click', () => { loadLevel(currentLevelIndex + 1); });
btnRestart.addEventListener('click', () => { loadLevel(currentLevelIndex); });
btnPlayAgain.addEventListener('click', () => { SoundEngine.init(); loadLevel(0); });

// Kick off
changeState('title');
requestAnimationFrame(loop);
