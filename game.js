/* ============================================
   CACAO FARM — Logique du jeu (Three.js)
   Étapes : 1) Récolter le cacao
            2) Recharger le Mobile Money (FCFA)
            3) Acheter du cacao avec le Mobile Money
   ============================================ */

import * as THREE from 'three';

/* ---------- Constantes de jeu ---------- */
const RECHARGE_AMOUNT = 5000;   // FCFA ajoutés à chaque recharge Mobile Money
const CACAO_PRICE     = 1000;   // FCFA pour acheter 1 cacao au marché
const INTERACT_RADIUS = 3.2;    // distance d'interaction avec une station
const PLAYER_SPEED     = 6.5;   // unités / seconde
const PROGRESS_STEP1   = 3;     // nombre de cabosses à récolter (étape 1)

/* ---------- État du jeu ---------- */
const state = {
    cacao: 0,
    money: 0,
    step: 1,               // étape guidée en cours (1,2,3 puis 0 = terminé)
    harvestedForStep: 0,   // cabosses récoltées depuis le début de l'étape 1
    rechargedOnce: false,
    boughtOnce: false,
    started: false,
};

/* ---------- Trois.js : scène de base ---------- */
const root = document.getElementById('game-root');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bd7ff);
scene.fog = new THREE.Fog(0x9bd7ff, 45, 80);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.appendChild(renderer.domElement);

/* Caméra orthographique = rendu isométrique façon Township */
let camera;
const CAM_OFFSET = new THREE.Vector3(18, 22, 18);
const VIEW_SIZE = 15;

function buildCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.OrthographicCamera(
        -VIEW_SIZE * aspect, VIEW_SIZE * aspect,
        VIEW_SIZE, -VIEW_SIZE,
        0.1, 200
    );
    camera.position.copy(CAM_OFFSET);
    camera.lookAt(0, 0, 0);
}
buildCamera();

function resize() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -VIEW_SIZE * aspect;
    camera.right = VIEW_SIZE * aspect;
    camera.top = VIEW_SIZE;
    camera.bottom = -VIEW_SIZE;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

/* ---------- Lumières ---------- */
const ambient = new THREE.HemisphereLight(0xffffff, 0x6b8e3a, 0.85);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff4d6, 1.1);
sun.position.set(20, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
const s = 40;
sun.shadow.camera.left = -s;
sun.shadow.camera.right = s;
sun.shadow.camera.top = s;
sun.shadow.camera.bottom = -s;
sun.shadow.bias = -0.0005;
scene.add(sun);

/* ---------- Sol ---------- */
const groundMat = new THREE.MeshStandardMaterial({ color: 0x7ec850, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* Parcelle de terre (là où poussent les cacaoyers) */
function addDirtPatch(x, z, w, d) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 1 });
    const patch = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d), mat);
    patch.position.set(x, 0.075, z);
    patch.receiveShadow = true;
    scene.add(patch);
}
addDirtPatch(-12, -6, 20, 20);

/* ---------- Cacaoyers et cabosses ---------- */
const cacaoTrees = [];   // { pods: [ {mesh, ripe, regrowAt} ], position }
const podColors = [0xd97706, 0xb91c1c, 0xf59e0b]; // cabosses jaune-orangé / rouge

function makeCacaoTree(x, z) {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);

    // Tronc
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.38, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 1 })
    );
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    tree.add(trunk);

    // Feuillage (plusieurs sphères vert foncé)
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 1 });
    const canopyPositions = [
        [0, 3.4, 0, 1.6], [-0.9, 3.0, 0.5, 1.1],
        [0.9, 3.0, -0.4, 1.1], [0.2, 3.9, -0.6, 1.0],
    ];
    canopyPositions.forEach(([px, py, pz, r]) => {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), leafMat);
        leaf.position.set(px, py, pz);
        leaf.castShadow = true;
        tree.add(leaf);
    });

    // Cabosses accrochées au tronc
    const pods = [];
    const podCount = 4;
    for (let i = 0; i < podCount; i++) {
        const angle = (i / podCount) * Math.PI * 2;
        const podMat = new THREE.MeshStandardMaterial({
            color: podColors[i % podColors.length], roughness: 0.7
        });
        const pod = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), podMat);
        pod.scale.set(0.7, 1.3, 0.7);            // forme allongée de cabosse
        pod.position.set(Math.cos(angle) * 0.5, 1.2 + i * 0.35, Math.sin(angle) * 0.5);
        pod.castShadow = true;
        tree.add(pod);
        pods.push({ mesh: pod, ripe: true, regrowAt: 0 });
    }

    scene.add(tree);
    cacaoTrees.push({ group: tree, pods, position: tree.position });
}

// Grille de cacaoyers
for (let ix = 0; ix < 3; ix++) {
    for (let iz = 0; iz < 3; iz++) {
        makeCacaoTree(-18 + ix * 5, -12 + iz * 5);
    }
}

/* ---------- Stations (kiosque Mobile Money + marché) ---------- */
const stations = [];

function makeSign(text, color) {
    // Petit panneau texturé avec du texte via canvas
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), mat);
    return sign;
}

// Kiosque Mobile Money (orange)
function makeMobileMoneyKiosk(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const booth = new THREE.Mesh(
        new THREE.BoxGeometry(3, 3, 3),
        new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.9 })
    );
    booth.position.y = 1.5;
    booth.castShadow = true;
    booth.receiveShadow = true;
    g.add(booth);

    const roof = new THREE.Mesh(
        new THREE.BoxGeometry(3.6, 0.4, 3.6),
        new THREE.MeshStandardMaterial({ color: 0xea580c })
    );
    roof.position.y = 3.2;
    roof.castShadow = true;
    g.add(roof);

    const sign = makeSign('Mobile Money', '#c2410c');
    sign.position.set(0, 2.2, 1.55);
    g.add(sign);

    scene.add(g);
    stations.push({ type: 'recharge', group: g, position: g.position, label: 'Recharger' });
}

// Marché (où on achète du cacao)
function makeMarket(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const stall = new THREE.Mesh(
        new THREE.BoxGeometry(4, 1.4, 2),
        new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.9 })
    );
    stall.position.y = 0.7;
    stall.castShadow = true;
    stall.receiveShadow = true;
    g.add(stall);

    // Toit rayé
    const roof = new THREE.Mesh(
        new THREE.BoxGeometry(4.6, 0.3, 2.6),
        new THREE.MeshStandardMaterial({ color: 0xdc2626 })
    );
    roof.position.set(0, 3.2, 0);
    roof.castShadow = true;
    g.add(roof);
    // Poteaux
    [[-2, 1], [2, 1], [-2, -1], [2, -1]].forEach(([px, pz]) => {
        const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.1, 3, 6),
            new THREE.MeshStandardMaterial({ color: 0x92400e })
        );
        post.position.set(px, 1.5, pz);
        post.castShadow = true;
        g.add(post);
    });

    // Tas de cacao sur l'étal
    const cacaoMat = new THREE.MeshStandardMaterial({ color: 0x7b3f00, roughness: 0.8 });
    for (let i = 0; i < 6; i++) {
        const bean = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), cacaoMat);
        bean.scale.set(0.8, 1.2, 0.8);
        bean.position.set(-1.3 + (i % 3) * 0.5, 1.55, -0.3 + Math.floor(i / 3) * 0.5);
        bean.castShadow = true;
        g.add(bean);
    }

    const sign = makeSign('Marché', '#1e3a8a');
    sign.position.set(0, 2.5, 1.05);
    g.add(sign);

    scene.add(g);
    stations.push({ type: 'buy', group: g, position: g.position, label: 'Acheter cacao' });
}

makeMobileMoneyKiosk(10, -4);
makeMarket(9, 6);

/* ---------- Décor : clôtures + arbres décoratifs ---------- */
function makeFencePost(x, z) {
    const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 1.2, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xb98a54 })
    );
    post.position.set(x, 0.6, z);
    post.castShadow = true;
    scene.add(post);
}
for (let i = -22; i <= 18; i += 2) { makeFencePost(i, 14); makeFencePost(i, -22); }

function makeDecoTree(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.3, 2, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b4423 })
    );
    trunk.position.y = 1; trunk.castShadow = true; g.add(trunk);
    const foliage = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0x1f6b2e })
    );
    foliage.position.y = 3; foliage.castShadow = true; g.add(foliage);
    scene.add(g);
}
makeDecoTree(16, 12); makeDecoTree(-20, 10); makeDecoTree(14, -18);

/* ---------- Personnage (fermier) ---------- */
const player = new THREE.Group();
player.position.set(0, 0, 2);
scene.add(player);

const skinMat = new THREE.MeshStandardMaterial({ color: 0x8d5524 });
const shirtMat = new THREE.MeshStandardMaterial({ color: 0xdb2777 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e40af });

// Corps
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.6, 4, 8), shirtMat);
torso.position.y = 1.1; torso.castShadow = true; player.add(torso);
// Tête
const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), skinMat);
head.position.y = 1.85; head.castShadow = true; player.add(head);
// Chapeau
const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0xca8a04 }));
hat.position.y = 2.08; hat.castShadow = true; player.add(hat);
// Jambes
const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 4, 6), pantsMat);
legL.position.set(-0.16, 0.5, 0); legL.castShadow = true; player.add(legL);
const legR = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 4, 6), pantsMat);
legR.position.set(0.16, 0.5, 0); legR.castShadow = true; player.add(legR);

/* ---------- Contrôles : joystick + clavier ---------- */
const input = { x: 0, y: 0 };   // vecteur de direction normalisé (-1..1)
const keys = {};

window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') doAction(); });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// Joystick tactile / souris
const joystick = document.getElementById('joystick');
const knob = document.getElementById('joystickKnob');
let joyActive = false;
let joyId = null;
let joyCenter = { x: 0, y: 0 };
const JOY_RADIUS = 44;

function joyStart(clientX, clientY) {
    const rect = joystick.getBoundingClientRect();
    joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    joyActive = true;
    joyMove(clientX, clientY);
}
function joyMove(clientX, clientY) {
    if (!joyActive) return;
    let dx = clientX - joyCenter.x;
    let dy = clientY - joyCenter.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, JOY_RADIUS);
    const ang = Math.atan2(dy, dx);
    const kx = Math.cos(ang) * clamped;
    const ky = Math.sin(ang) * clamped;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    input.x = kx / JOY_RADIUS;
    input.y = ky / JOY_RADIUS;
}
function joyEnd() {
    joyActive = false;
    joyId = null;
    input.x = 0; input.y = 0;
    knob.style.transform = 'translate(0px, 0px)';
}

joystick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    joyId = t.identifier;
    joyStart(t.clientX, t.clientY);
    e.preventDefault();
}, { passive: false });
joystick.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
        if (t.identifier === joyId) { joyMove(t.clientX, t.clientY); e.preventDefault(); }
    }
}, { passive: false });
window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === joyId) joyEnd();
});
// Souris (desktop)
joystick.addEventListener('mousedown', (e) => { joyStart(e.clientX, e.clientY); });
window.addEventListener('mousemove', (e) => { if (joyActive) joyMove(e.clientX, e.clientY); });
window.addEventListener('mouseup', () => { if (joyActive) joyEnd(); });

/* ---------- Interactions ---------- */
const actionBtn = document.getElementById('actionBtn');
const actionLabel = document.getElementById('actionLabel');
actionBtn.addEventListener('click', doAction);

let currentInteraction = null; // { kind: 'tree'|'recharge'|'buy', ref, label }

function updateNearestInteraction() {
    let best = null;
    let bestDist = INTERACT_RADIUS;

    // Cacaoyers avec au moins une cabosse mûre
    for (const tree of cacaoTrees) {
        const d = player.position.distanceTo(tree.position);
        if (d < bestDist && tree.pods.some(p => p.ripe)) {
            bestDist = d;
            best = { kind: 'tree', ref: tree, label: '🌳 Récolter' };
        }
    }
    // Stations
    for (const st of stations) {
        const d = player.position.distanceTo(st.position);
        if (d < bestDist) {
            bestDist = d;
            const label = st.type === 'recharge'
                ? '📱 Recharger'
                : `🛒 Acheter (${CACAO_PRICE} FCFA)`;
            best = { kind: st.type, ref: st, label };
        }
    }

    currentInteraction = best;
    if (best) {
        actionLabel.textContent = best.label;
        actionBtn.classList.remove('hidden');
    } else {
        actionBtn.classList.add('hidden');
    }
}

function doAction() {
    if (!currentInteraction || !state.started) return;

    if (currentInteraction.kind === 'tree') {
        harvestFrom(currentInteraction.ref);
    } else if (currentInteraction.kind === 'recharge') {
        rechargeMobileMoney();
    } else if (currentInteraction.kind === 'buy') {
        buyCacao();
    }
}

function harvestFrom(tree) {
    const pod = tree.pods.find(p => p.ripe);
    if (!pod) return;
    pod.ripe = false;
    pod.mesh.visible = false;
    pod.regrowAt = clockTime + 6; // repousse après 6 s
    state.cacao += 1;
    updateHUD();
    floaty('+1 🍫', 0x7b3f00);

    if (state.step === 1) {
        state.harvestedForStep += 1;
        if (state.harvestedForStep >= PROGRESS_STEP1) advanceStep();
        else updateObjective();
    }
}

function rechargeMobileMoney() {
    state.money += RECHARGE_AMOUNT;
    updateHUD();
    floaty(`+${formatFCFA(RECHARGE_AMOUNT)}`, 0xea8a00);
    if (!state.rechargedOnce) {
        state.rechargedOnce = true;
        if (state.step === 2) advanceStep();
    }
}

function buyCacao() {
    if (state.money < CACAO_PRICE) {
        floaty('Solde insuffisant !', 0xdc2626);
        return;
    }
    state.money -= CACAO_PRICE;
    state.cacao += 1;
    updateHUD();
    floaty(`-${formatFCFA(CACAO_PRICE)}`, 0xdc2626);
    if (!state.boughtOnce) {
        state.boughtOnce = true;
        if (state.step === 3) advanceStep();
    }
}

/* ---------- Objectifs guidés ---------- */
const objectiveEl = document.getElementById('objective');
const objectiveStepEl = document.getElementById('objectiveStep');
const objectiveTextEl = document.getElementById('objectiveText');
const objectiveProgressEl = document.getElementById('objectiveProgress');

function updateObjective() {
    if (state.step === 1) {
        objectiveStepEl.textContent = 'Étape 1 / 3';
        objectiveTextEl.textContent = 'Récolte le cacao 🌳';
        objectiveProgressEl.textContent = `${state.harvestedForStep} / ${PROGRESS_STEP1} cabosses`;
    } else if (state.step === 2) {
        objectiveStepEl.textContent = 'Étape 2 / 3';
        objectiveTextEl.textContent = 'Recharge ton Mobile Money 📱';
        objectiveProgressEl.textContent = 'Va au kiosque orange';
    } else if (state.step === 3) {
        objectiveStepEl.textContent = 'Étape 3 / 3';
        objectiveTextEl.textContent = 'Achète du cacao au marché 🛒';
        objectiveProgressEl.textContent = `Coût : ${formatFCFA(CACAO_PRICE)}`;
    } else {
        objectiveStepEl.textContent = 'Terminé 🎉';
        objectiveTextEl.textContent = 'Bravo ! Continue à jouer librement.';
        objectiveProgressEl.textContent = '';
    }
}

function advanceStep() {
    state.step = state.step >= 3 ? 0 : state.step + 1;
    updateObjective();
    objectiveEl.classList.remove('pop');
    void objectiveEl.offsetWidth; // relance l'animation
    objectiveEl.classList.add('pop');
}

/* ---------- HUD & utilitaires ---------- */
const cacaoValueEl = document.getElementById('cacaoValue');
const moneyValueEl = document.getElementById('moneyValue');

function updateHUD() {
    cacaoValueEl.textContent = state.cacao;
    moneyValueEl.textContent = formatFCFA(state.money, false);
}

function formatFCFA(n, withUnit = true) {
    const s = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return withUnit ? `${s} FCFA` : s;
}

// Texte flottant projeté au-dessus du joueur
function floaty(text, color = 0xffffff) {
    const el = document.createElement('div');
    el.className = 'floaty';
    el.textContent = text;
    el.style.color = '#' + color.toString(16).padStart(6, '0');
    document.getElementById('hud').appendChild(el);

    const world = player.position.clone();
    world.y += 2.4;
    const screen = worldToScreen(world);
    el.style.left = screen.x + 'px';
    el.style.top = screen.y + 'px';
    setTimeout(() => el.remove(), 1100);
}

function worldToScreen(vec3) {
    const v = vec3.clone().project(camera);
    return {
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
}

/* ---------- Boucle de jeu ---------- */
const clock = new THREE.Clock();
let clockTime = 0;
let walkPhase = 0;

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    clockTime += dt;

    // Direction depuis clavier
    let mx = input.x;
    let my = input.y;
    if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) my += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;

    // Conversion écran -> monde (repère isométrique) : on aligne sur les axes de la caméra.
    // « Haut » de l'écran = s'éloigner de la caméra (-x,-z) ; « droite » = (+x,-z).
    let moveX = mx + my;
    let moveZ = my - mx;
    const len = Math.hypot(moveX, moveZ);

    if (len > 0.05 && state.started) {
        moveX /= len; moveZ /= len;
        const speed = PLAYER_SPEED * Math.min(1, Math.hypot(mx, my));
        player.position.x += moveX * speed * dt;
        player.position.z += moveZ * speed * dt;
        // limites du terrain
        player.position.x = THREE.MathUtils.clamp(player.position.x, -24, 16);
        player.position.z = THREE.MathUtils.clamp(player.position.z, -22, 13);
        // orientation
        player.rotation.y = Math.atan2(moveX, moveZ);
        // animation de marche
        walkPhase += dt * 12;
        legL.rotation.x = Math.sin(walkPhase) * 0.6;
        legR.rotation.x = -Math.sin(walkPhase) * 0.6;
        torso.position.y = 1.1 + Math.abs(Math.sin(walkPhase)) * 0.05;
    } else {
        legL.rotation.x *= 0.8;
        legR.rotation.x *= 0.8;
    }

    // Repousse des cabosses
    for (const tree of cacaoTrees) {
        for (const pod of tree.pods) {
            if (!pod.ripe && clockTime >= pod.regrowAt) {
                pod.ripe = true;
                pod.mesh.visible = true;
            }
        }
    }

    // Caméra suit le joueur
    camera.position.copy(player.position).add(CAM_OFFSET);
    camera.lookAt(player.position.x, 1, player.position.z);

    updateNearestInteraction();
    renderer.render(scene, camera);
}
animate();

/* ---------- Démarrage ---------- */
const startScreen = document.getElementById('startScreen');
document.getElementById('startBtn').addEventListener('click', () => {
    state.started = true;
    startScreen.classList.add('hidden');
    updateHUD();
    updateObjective();
});
updateHUD();
updateObjective();

/* ---------- Hook de test (inoffensif) ---------- */
window.__dbg = () => ({
    player: [player.position.x.toFixed(1), player.position.z.toFixed(1)],
    interaction: currentInteraction ? currentInteraction.label : null,
    cacao: state.cacao, money: state.money, step: state.step,
});
