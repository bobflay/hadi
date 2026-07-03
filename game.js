/* ============================================
   CACAO TRAÇABILITÉ — Système National de Traçabilité (SNT)
   Conseil du Café-Cacao (Côte d'Ivoire)

   Parcours gamifié (3 stations) :
     1. Géolocaliser sa parcelle (bornes) → enregistrement EUDR
     2. Retirer la Carte du Producteur au Guichet CCC
     3. Récolter le cacao (remplir les sacs)
     4. Vente tracée à la coopérative :
        scan carte → pesée → scellés → prix officiel → paiement Carte
     + Cash-out de la Carte vers Mobile Money
   ============================================ */

import * as THREE from 'three';

/* ---------- Constantes ---------- */
const OFFICIAL_PRICE   = 1800;  // FCFA / kg — prix bord-champ officiel (paramétrable)
const SACK_KG          = 65;    // kg par sac de jute (pour le nombre de scellés)
const HARVEST_MIN_KG   = 6;     // kg de fèves séchées par cabosse récoltée (min)
const HARVEST_MAX_KG   = 10;    // kg (max)
const HARVEST_TARGET   = 40;    // kg à récolter pour valider l'étape guidée
const INTERACT_RADIUS  = 3.2;
const BORNE_RADIUS     = 2.8;   // rayon de capture d'une borne (géoloc)
const PLAYER_SPEED     = 6.5;

const ZONES = ['DALOA', 'SAN-PÉDRO', 'SOUBRÉ', 'ABENGOUROU', 'GAGNOA',
    'DIVO', 'ABOISSO', 'DUÉKOUÉ', 'MÉAGUI', 'BONGOUANOU', 'AGBOVILLE', 'ISSIA', 'MAN'];

/* ---------- État ---------- */
const state = {
    started: false,
    step: 1,               // 1 géoloc, 2 carte, 3 récolte, 4 vente, 0 = libre
    bornesVisited: 0,
    plotRegistered: false,
    hasCard: false,
    matricule: '',
    zone: '',
    cacaoKg: 0,            // fèves récoltées, pas encore vendues
    cardBalance: 0,        // FCFA sur la Carte du Producteur
    mobileMoney: 0,        // FCFA transférés en Mobile Money
    score: 0,              // score de traçabilité
    firstSaleDone: false,
    busy: false,           // séquence de vente en cours
};

/* ---------- Scène ---------- */
const root = document.getElementById('game-root');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bd7ff);
scene.fog = new THREE.Fog(0x9bd7ff, 45, 85);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.appendChild(renderer.domElement);

let camera;
const CAM_OFFSET = new THREE.Vector3(18, 22, 18);
const VIEW_SIZE = 15;
function buildCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.OrthographicCamera(
        -VIEW_SIZE * aspect, VIEW_SIZE * aspect, VIEW_SIZE, -VIEW_SIZE, 0.1, 200);
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
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8e3a, 0.85));
const sun = new THREE.DirectionalLight(0xfff4d6, 1.1);
sun.position.set(20, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
const sc = 40;
sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
sun.shadow.bias = -0.0005;
scene.add(sun);

/* ---------- Sol ---------- */
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0x7ec850, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Parcelle (terre) où poussent les cacaoyers
const dirt = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.15, 16),
    new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 1 }));
dirt.position.set(-13, 0.075, -6);
dirt.receiveShadow = true;
scene.add(dirt);

/* ---------- Cacaoyers ---------- */
const cacaoTrees = [];
const podColors = [0xd97706, 0xb91c1c, 0xf59e0b];

function makeCacaoTree(x, z) {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.38, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 1 }));
    trunk.position.y = 1.5; trunk.castShadow = true; tree.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 1 });
    [[0, 3.4, 0, 1.6], [-0.9, 3.0, 0.5, 1.1], [0.9, 3.0, -0.4, 1.1], [0.2, 3.9, -0.6, 1.0]]
        .forEach(([px, py, pz, r]) => {
            const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), leafMat);
            leaf.position.set(px, py, pz); leaf.castShadow = true; tree.add(leaf);
        });
    const pods = [];
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const pod = new THREE.Mesh(
            new THREE.SphereGeometry(0.32, 8, 8),
            new THREE.MeshStandardMaterial({ color: podColors[i % 3], roughness: 0.7 }));
        pod.scale.set(0.7, 1.3, 0.7);
        pod.position.set(Math.cos(angle) * 0.5, 1.2 + i * 0.35, Math.sin(angle) * 0.5);
        pod.castShadow = true; tree.add(pod);
        pods.push({ mesh: pod, ripe: true, regrowAt: 0 });
    }
    scene.add(tree);
    cacaoTrees.push({ group: tree, pods, position: tree.position });
}
for (let ix = 0; ix < 3; ix++)
    for (let iz = 0; iz < 3; iz++)
        makeCacaoTree(-18 + ix * 5, -12 + iz * 5);

/* ---------- Bornes de géolocalisation (parcelle) ---------- */
const bornes = [];
const BORNE_CORNERS = [[-20.5, -14.5], [-5.5, -14.5], [-5.5, 2.5], [-20.5, 2.5]];
BORNE_CORNERS.forEach(([x, z]) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6),
        new THREE.MeshStandardMaterial({ color: 0xffffff }));
    pole.position.y = 1.1; pole.castShadow = true; g.add(pole);
    const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 0.6),
        new THREE.MeshStandardMaterial({ color: 0xdc2626, side: THREE.DoubleSide }));
    flag.position.set(0.5, 1.9, 0); flag.castShadow = true; g.add(flag);
    scene.add(g);
    bornes.push({ group: g, flag, position: g.position, visited: false });
});

// Ligne de la parcelle (polygone) tracée une fois toutes les bornes visitées
let plotLine = null;
function drawPlotPolygon() {
    const pts = BORNE_CORNERS.map(([x, z]) => new THREE.Vector3(x, 0.2, z));
    pts.push(pts[0].clone());
    plotLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x22d3ee }));
    scene.add(plotLine);
    // Remplissage translucide
    const shape = new THREE.Shape(BORNE_CORNERS.map(([x, z]) => new THREE.Vector2(x, z)));
    const fill = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    fill.rotation.x = Math.PI / 2;
    fill.position.y = 0.18;
    scene.add(fill);
}

/* ---------- Panneaux texte ---------- */
function makeSign(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px Segoe UI, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    text.split('\n').forEach((line, i, arr) =>
        ctx.fillText(line, 128, 64 + (i - (arr.length - 1) / 2) * 40));
    const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4;
    return new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5),
        new THREE.MeshBasicMaterial({ map: tex }));
}

/* ---------- Stations ---------- */
const stations = [];

// Guichet CCC (vert institutionnel) : carte + cash-out
function makeCccDesk(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const booth = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3),
        new THREE.MeshStandardMaterial({ color: 0x0f7a3d, roughness: 0.9 }));
    booth.position.y = 1.5; booth.castShadow = true; booth.receiveShadow = true; g.add(booth);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.4, 3.6),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b }));
    roof.position.y = 3.2; roof.castShadow = true; g.add(roof);
    const sign = makeSign('Guichet CCC', '#0a5c2e');
    sign.position.set(0, 2.2, 1.55); g.add(sign);
    scene.add(g);
    stations.push({ type: 'ccc', group: g, position: g.position });
}

// Coopérative (bâtiment + TPE + sacs) : vente tracée
function makeCoop(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const build = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 3.5),
        new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.95 }));
    build.position.y = 1.5; build.castShadow = true; build.receiveShadow = true; g.add(build);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.4, 4),
        new THREE.MeshStandardMaterial({ color: 0x7f1d1d }));
    roof.position.y = 3.7; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    // Comptoir + TPE
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x2563eb }));
    counter.position.set(0, 0.5, 2.4); counter.castShadow = true; g.add(counter);
    const tpe = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x111827 }));
    tpe.position.set(0.6, 1.07, 2.4); g.add(tpe);
    // Sacs de jute
    const sackMat = new THREE.MeshStandardMaterial({ color: 0xcaa472, roughness: 1 });
    [[-1.4, 2.6], [-1.0, 2.9], [-1.7, 2.9]].forEach(([sx, sz]) => {
        const sack = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.5, 4, 8), sackMat);
        sack.position.set(sx, 0.5, sz); sack.castShadow = true; g.add(sack);
    });
    const sign = makeSign('Coopérative', '#1e3a8a');
    sign.position.set(0, 2.6, 1.8); g.add(sign);
    scene.add(g);
    stations.push({ type: 'coop', group: g, position: g.position });
}

makeCccDesk(10, -4);
makeCoop(9, 7);
const cccPos = new THREE.Vector3(10, 0, -4);
const coopPos = new THREE.Vector3(9, 0, 7);

/* ---------- Décor ---------- */
function makeFencePost(x, z) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xb98a54 }));
    post.position.set(x, 0.6, z); post.castShadow = true; scene.add(post);
}
for (let i = -22; i <= 18; i += 2) { makeFencePost(i, 15); makeFencePost(i, -23); }

function makeDecoTree(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b4423 }));
    trunk.position.y = 1; trunk.castShadow = true; g.add(trunk);
    const fol = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0x1f6b2e }));
    fol.position.y = 3; fol.castShadow = true; g.add(fol);
    scene.add(g);
}
makeDecoTree(16, 13); makeDecoTree(-20, 12); makeDecoTree(15, -20);

/* ---------- Camion de l'exportateur (demande + vie du monde) ---------- */
const truck = new THREE.Group();
truck.position.set(15, 0, 10);
truck.rotation.y = -Math.PI / 4;
const truckBaseY = truck.position.y;
{
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.55 });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.9), bodyMat);
    bed.position.set(-0.7, 0.95, 0); bed.castShadow = true; truck.add(bed);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.9), bodyMat);
    cab.position.set(1.1, 1.0, 0); cab.castShadow = true; truck.add(cab);
    const window_ = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.7),
        new THREE.MeshStandardMaterial({ color: 0x0f172a }));
    window_.position.set(1.15, 1.7, 0); truck.add(window_);
    // Cargaison : sacs tracés
    const sackMat = new THREE.MeshStandardMaterial({ color: 0xcaa472, roughness: 1 });
    [[-1.1, -0.4], [-1.1, 0.4], [-0.4, 0]].forEach(([sx, sz]) => {
        const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.35, 4, 6), sackMat);
        s.position.set(sx, 1.6, sz); s.castShadow = true; truck.add(s);
    });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827 });
    [[-1.3, 0.95], [-1.3, -0.95], [1.0, 0.95], [1.0, -0.95]].forEach(([wx, wz]) => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), wheelMat);
        w.rotation.x = Math.PI / 2; w.position.set(wx, 0.42, wz); w.castShadow = true; truck.add(w);
    });
}
scene.add(truck);
let truckPop = 0;

/* ---------- Personnage ---------- */
const player = new THREE.Group();
player.position.set(2, 0, 4);
scene.add(player);
const skinMat = new THREE.MeshStandardMaterial({ color: 0x8d5524 });
const shirtMat = new THREE.MeshStandardMaterial({ color: 0xdb2777 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e40af });
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.6, 4, 8), shirtMat);
torso.position.y = 1.1; torso.castShadow = true; player.add(torso);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), skinMat);
head.position.y = 1.85; head.castShadow = true; player.add(head);
const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0xca8a04 }));
hat.position.y = 2.08; hat.castShadow = true; player.add(hat);
const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 4, 6), pantsMat);
legL.position.set(-0.16, 0.5, 0); legL.castShadow = true; player.add(legL);
const legR = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 4, 6), pantsMat);
legR.position.set(0.16, 0.5, 0); legR.castShadow = true; player.add(legR);

/* ---------- Contrôles ---------- */
const input = { x: 0, y: 0 };
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') doAction(); });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

const joystick = document.getElementById('joystick');
const knob = document.getElementById('joystickKnob');
let joyActive = false, joyId = null, joyCenter = { x: 0, y: 0 };
const JOY_RADIUS = 44;
function joyStart(cx, cy) {
    const r = joystick.getBoundingClientRect();
    joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    joyActive = true; joyMove(cx, cy);
}
function joyMove(cx, cy) {
    if (!joyActive) return;
    const dx = cx - joyCenter.x, dy = cy - joyCenter.y;
    const dist = Math.min(Math.hypot(dx, dy), JOY_RADIUS);
    const ang = Math.atan2(dy, dx);
    const kx = Math.cos(ang) * dist, ky = Math.sin(ang) * dist;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    input.x = kx / JOY_RADIUS; input.y = ky / JOY_RADIUS;
}
function joyEnd() {
    joyActive = false; joyId = null; input.x = 0; input.y = 0;
    knob.style.transform = 'translate(0px, 0px)';
}
joystick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; joyId = t.identifier; joyStart(t.clientX, t.clientY); e.preventDefault();
}, { passive: false });
joystick.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === joyId) { joyMove(t.clientX, t.clientY); e.preventDefault(); }
}, { passive: false });
window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === joyId) joyEnd();
});
joystick.addEventListener('mousedown', (e) => joyStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => { if (joyActive) joyMove(e.clientX, e.clientY); });
window.addEventListener('mouseup', () => { if (joyActive) joyEnd(); });

/* ---------- Interactions ---------- */
const actionBtn = document.getElementById('actionBtn');
const actionLabel = document.getElementById('actionLabel');
actionBtn.addEventListener('click', doAction);
let currentInteraction = null;

function updateNearestInteraction() {
    if (state.busy || !state.started) { actionBtn.classList.add('hidden'); currentInteraction = null; return; }
    let best = null, bestDist = INTERACT_RADIUS;
    for (const tree of cacaoTrees) {
        const d = player.position.distanceTo(tree.position);
        if (d < bestDist && tree.pods.some(p => p.ripe)) {
            bestDist = d; best = { kind: 'tree', ref: tree, label: '🌳 Récolter' };
        }
    }
    for (const st of stations) {
        const d = player.position.distanceTo(st.position);
        if (d < bestDist) {
            bestDist = d;
            let label;
            if (st.type === 'ccc') {
                label = !state.hasCard ? '💳 Retirer ma Carte'
                    : (state.cardBalance > 0 ? '📱 Cash-out Mobile Money' : 'ℹ️ Services CCC');
            } else { // coop
                label = '🤝 Vente tracée';
            }
            best = { kind: st.type, ref: st, label };
        }
    }
    currentInteraction = best;
    if (best) { actionLabel.textContent = best.label; actionBtn.classList.remove('hidden'); }
    else actionBtn.classList.add('hidden');
}

function doAction() {
    if (!currentInteraction || !state.started || state.busy) return;
    if (currentInteraction.kind === 'tree') harvestFrom(currentInteraction.ref);
    else if (currentInteraction.kind === 'ccc') cccAction();
    else if (currentInteraction.kind === 'coop') tracedSale();
}

/* ---------- Récolte ---------- */
function harvestFrom(tree) {
    const pod = tree.pods.find(p => p.ripe);
    if (!pod) return;
    const wp = new THREE.Vector3(); pod.mesh.getWorldPosition(wp);
    spawnFlyer(wp); sfx.pluck();
    pod.ripe = false; pod.mesh.visible = false; pod.regrowAt = clockTime + 6;
    const kg = Math.round(HARVEST_MIN_KG + Math.random() * (HARVEST_MAX_KG - HARVEST_MIN_KG));
    state.cacaoKg += kg;
    updateHUD();
    floaty(`+${kg} kg 🍫`, 0x7b3f00);
    if (state.step === 3) {
        if (state.cacaoKg >= HARVEST_TARGET) advanceStep();
        else updateObjective();
    }
}

/* ---------- Guichet CCC : carte + cash-out ---------- */
function cccAction() {
    if (!state.hasCard) { issueCard(); return; }
    if (state.cardBalance > 0) {
        const amount = state.cardBalance;
        state.mobileMoney += amount; state.cardBalance = 0;
        updateHUD(); sfx.coin();
        floaty(`→ 📱 +${formatFCFA(amount, false)}`, 0xea8a00);
    } else {
        sfx.error();
        floaty('Solde Carte vide', 0x6b7280);
    }
}

function issueCard() {
    if (!state.plotRegistered) {
        sfx.error();
        showInfo('🛰️', 'Parcelle non enregistrée',
            "Tu dois d'abord géolocaliser ta parcelle en longeant les 4 bornes. " +
            "La Carte du Producteur est délivrée après le recensement de ton verger.");
        return;
    }
    sfx.card();
    state.hasCard = true;
    state.zone = ZONES[Math.floor(Math.random() * ZONES.length)];
    state.matricule = 'CCC-' + state.zone.slice(0, 3).toUpperCase() + '-' +
        Math.floor(100000 + Math.random() * 899999);
    renderProducerCard();
    addScore(30);
    updateHUD();
    showInfo('💳', 'Carte du Producteur délivrée',
        `Matricule unique : ${state.matricule} (zone ${state.zone}). ` +
        "Elle porte ton identité, un QR code et une puce bancaire (Visa). " +
        "Elle sécurise ton paiement au prix officiel et ouvre la CMU (santé) à 100 %. " +
        "Depuis le 1ᵉʳ septembre 2026, elle est obligatoire pour toute vente de cacao.");
    if (state.step === 2) advanceStep();
}

/* ---------- Vente tracée à la coopérative ---------- */
const salePanel = document.getElementById('salePanel');
const saleResult = document.getElementById('saleResult');

async function tracedSale() {
    if (!state.hasCard) {
        sfx.error();
        showInfo('💳', 'Carte requise',
            "La vente tracée exige la Carte du Producteur. Passe au Guichet CCC pour la retirer.");
        return;
    }
    if (state.cacaoKg <= 0) {
        sfx.error();
        showInfo('🍫', 'Aucune fève à vendre',
            "Récolte d'abord du cacao dans ta parcelle, puis reviens vendre à la coopérative.");
        return;
    }

    state.busy = true;
    actionBtn.classList.add('hidden');
    const kg = state.cacaoKg;
    const seals = Math.max(1, Math.ceil(kg / SACK_KG));
    const amount = kg * OFFICIAL_PRICE;
    const sealNo = Math.floor(100000 + Math.random() * 899999);

    // Réinitialiser le panneau
    const items = salePanel.querySelectorAll('#saleSteps li');
    items.forEach(li => li.classList.remove('done', 'active'));
    saleResult.textContent = '';
    salePanel.classList.remove('hidden');

    const detail = {
        scan: `Carte ${state.matricule} ✓`,
        weigh: `${kg} kg pesés`,
        seal: `${seals} sac(s) · scellés n° ${sealNo}…`,
        price: `${kg} × ${OFFICIAL_PRICE} FCFA/kg`,
        pay: `+${formatFCFA(amount, false)} FCFA sur la Carte`,
        sms: `Connaissement lié à la zone ${state.zone}`,
    };

    for (const li of items) {
        li.classList.add('active');
        await wait(520);
        li.classList.remove('active'); li.classList.add('done');
        li.textContent = li.textContent.split(' — ')[0] + ' — ' + detail[li.dataset.k];
        if (li.dataset.k === 'pay') sfx.coin(); else sfx.tick();
    }

    // Appliquer les effets
    state.cacaoKg = 0;
    state.cardBalance += amount;
    addScore(20);
    addTracedToOrder(kg);
    updateHUD();
    saleResult.textContent = `✅ Vente tracée : +${formatFCFA(amount)}`;

    await wait(1400);
    salePanel.classList.add('hidden');
    // Restaurer les libellés d'étapes
    items.forEach(li => { li.textContent = li.textContent.split(' — ')[0]; });
    state.busy = false;

    if (!state.firstSaleDone) {
        state.firstSaleDone = true;
        showInfo('🤝', 'Vente 100 % tracée',
            "Ta carte a été scannée sur le TPE, les sacs pesés et scellés, le paiement calculé au prix officiel. " +
            "Un connaissement relie ta parcelle géolocalisée à l'expédition : producteur → coopérative → exportateur → usine. " +
            "C'est ainsi que le cacao ivoirien prouve son origine, de la plantation jusqu'à l'usine (conformité EUDR).");
    }
    if (state.step === 4) advanceStep();
}

/* ---------- Enregistrement de la parcelle ---------- */
function registerPlot() {
    state.plotRegistered = true;
    drawPlotPolygon();
    addScore(30);
    sfx.success();
    showInfo('🛰️', 'Parcelle géolocalisée',
        "Les 4 bornes tracent le polygone de ta parcelle. À l'échelle nationale, le Conseil du Café-Cacao " +
        "a géolocalisé ~3 millions d'hectares de vergers. Cette carte prouve que ton cacao est « zéro déforestation » " +
        "— exigence du règlement européen EUDR (en vigueur au 1ᵉʳ janvier 2027).");
    if (state.step === 1) advanceStep();
}

/* ---------- Objectifs guidés ---------- */
const objectiveEl = document.getElementById('objective');
const objectiveStepEl = document.getElementById('objectiveStep');
const objectiveTextEl = document.getElementById('objectiveText');
const objectiveProgressEl = document.getElementById('objectiveProgress');

function updateObjective() {
    if (state.step === 1) {
        objectiveStepEl.textContent = 'Étape 1 / 4';
        objectiveTextEl.textContent = 'Géolocalise ta parcelle 🛰️';
        objectiveProgressEl.textContent = `Longe les bornes : ${state.bornesVisited} / 4`;
    } else if (state.step === 2) {
        objectiveStepEl.textContent = 'Étape 2 / 4';
        objectiveTextEl.textContent = 'Retire ta Carte du Producteur 💳';
        objectiveProgressEl.textContent = 'Va au Guichet CCC (vert)';
    } else if (state.step === 3) {
        objectiveStepEl.textContent = 'Étape 3 / 4';
        objectiveTextEl.textContent = 'Récolte le cacao 🌳';
        objectiveProgressEl.textContent = `${state.cacaoKg} / ${HARVEST_TARGET} kg`;
    } else if (state.step === 4) {
        objectiveStepEl.textContent = 'Étape 4 / 4';
        objectiveTextEl.textContent = 'Vente tracée à la coopérative 🤝';
        objectiveProgressEl.textContent = 'Va à la Coopérative';
    } else {
        objectiveStepEl.textContent = 'Parcours terminé 🎉';
        objectiveTextEl.textContent = 'Récolte, vends, encaisse en Mobile Money !';
        objectiveProgressEl.textContent = `Score de traçabilité : ${state.score}`;
    }
}

function advanceStep() {
    state.step = state.step >= 4 ? 0 : state.step + 1;
    updateObjective();
    objectiveEl.classList.remove('pop'); void objectiveEl.offsetWidth; objectiveEl.classList.add('pop');
    // Fin du tutoriel → la demande de l'exportateur démarre
    if (state.step === 0 && !state.order.active) activateOrder(120);
}

/* ---------- HUD ---------- */
const cacaoValueEl = document.getElementById('cacaoValue');
const cardValueEl = document.getElementById('cardValue');
const moneyValueEl = document.getElementById('moneyValue');
const scoreValueEl = document.getElementById('scoreValue');

const disp = { cacaoKg: 0, cardBalance: 0, mobileMoney: 0, score: 0 };
function updateHUD() { /* les valeurs sont animées dans tickHUD() */ }
function tickHUD(dt) {
    for (const k of ['cacaoKg', 'cardBalance', 'mobileMoney', 'score']) {
        if (Math.abs(disp[k] - state[k]) < 1) disp[k] = state[k];
        else disp[k] += (state[k] - disp[k]) * Math.min(1, dt * 10);
    }
    cacaoValueEl.textContent = Math.round(disp.cacaoKg);
    cardValueEl.textContent = formatFCFA(disp.cardBalance, false);
    moneyValueEl.textContent = formatFCFA(disp.mobileMoney, false);
    scoreValueEl.textContent = Math.round(disp.score);
}
function addScore(n) { state.score += n; }

function formatFCFA(n, withUnit = true) {
    const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return withUnit ? `${s} FCFA` : s;
}

/* ---------- Carte du Producteur (UI) ---------- */
const producerCardEl = document.getElementById('producerCard');
function renderProducerCard() {
    document.getElementById('pcName').textContent = 'Producteur·rice';
    document.getElementById('pcZone').textContent = 'Zone : ' + state.zone;
    document.getElementById('pcMat').textContent = state.matricule;
    drawFakeQR(document.getElementById('pcQR'));
    producerCardEl.classList.remove('hidden');
}
function drawFakeQR(canvas) {
    const ctx = canvas.getContext('2d');
    const N = 16, s = canvas.width / N;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
            if (Math.random() > 0.5) ctx.fillRect(x * s, y * s, s, s);
    // 3 repères d'angle
    const marker = (mx, my) => {
        ctx.fillStyle = '#000'; ctx.fillRect(mx, my, s * 5, s * 5);
        ctx.fillStyle = '#fff'; ctx.fillRect(mx + s, my + s, s * 3, s * 3);
        ctx.fillStyle = '#000'; ctx.fillRect(mx + s * 2, my + s * 2, s, s);
    };
    marker(0, 0); marker(s * 11, 0); marker(0, s * 11);
}

/* ---------- Fiche d'information ---------- */
const infoModal = document.getElementById('infoModal');
document.getElementById('modalBtn').addEventListener('click', () => infoModal.classList.add('hidden'));
function showInfo(emoji, title, text) {
    document.getElementById('modalEmoji').textContent = emoji;
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalText').textContent = text;
    infoModal.classList.remove('hidden');
}

/* ---------- Texte flottant ---------- */
function floaty(text, color = 0xffffff) {
    const el = document.createElement('div');
    el.className = 'floaty'; el.textContent = text;
    el.style.color = '#' + color.toString(16).padStart(6, '0');
    document.getElementById('hud').appendChild(el);
    const world = player.position.clone(); world.y += 2.4;
    const s = worldToScreen(world);
    el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
    setTimeout(() => el.remove(), 1100);
}
function worldToScreen(v3) {
    const v = v3.clone().project(camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------- Audio (WebAudio, autonome) ---------- */
let actx = null;
function initAudio() { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* silencieux */ } }
function beep(freq, dur = 0.12, type = 'sine', vol = 0.2, when = 0) {
    if (!actx) return;
    const t = actx.currentTime + when;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(actx.destination);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.start(t); o.stop(t + dur);
}
const sfx = {
    pluck: () => beep(680, 0.09, 'triangle', 0.16),
    collect: () => beep(920, 0.07, 'sine', 0.1),
    card: () => { beep(523, 0.12, 'sine', 0.18); beep(784, 0.16, 'sine', 0.18, 0.1); },
    coin: () => { beep(988, 0.06, 'square', 0.1); beep(1319, 0.1, 'square', 0.1, 0.06); },
    success: () => { beep(523, 0.12, 'sine', 0.2); beep(659, 0.12, 'sine', 0.2, 0.1); beep(988, 0.2, 'sine', 0.2, 0.22); },
    error: () => beep(150, 0.25, 'sawtooth', 0.16),
    tick: () => beep(560, 0.05, 'sine', 0.07),
};

/* ---------- Fèves volantes (juice de récolte) ---------- */
const flyers = [];
const beanGeo = new THREE.SphereGeometry(0.16, 8, 8);
const beanMat = new THREE.MeshStandardMaterial({ color: 0x7b3f00 });
function spawnFlyer(worldPos) {
    const m = new THREE.Mesh(beanGeo, beanMat);
    m.position.copy(worldPos); scene.add(m);
    flyers.push({ mesh: m, t: 0, from: worldPos.clone() });
}

/* ---------- Flèche + chemin de guidage ---------- */
const guideArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.1, 4),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, emissiveIntensity: 0.6 }));
guideArrow.rotation.x = Math.PI;
guideArrow.visible = false;
scene.add(guideArrow);
const guideLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0x22d3ee, dashSize: 0.55, gapSize: 0.4 }));
guideLine.visible = false;
scene.add(guideLine);

function nearestRipeTree() {
    let t = null, bd = Infinity;
    for (const tr of cacaoTrees)
        if (tr.pods.some(p => p.ripe)) {
            const d = player.position.distanceTo(tr.position);
            if (d < bd) { bd = d; t = tr.position; }
        }
    return t;
}
function objectiveTarget() {
    if (state.step === 1) {
        let t = null, bd = Infinity;
        for (const b of bornes) if (!b.visited) {
            const d = player.position.distanceTo(b.position);
            if (d < bd) { bd = d; t = b.position; }
        }
        return t;
    }
    if (state.step === 2) return cccPos;
    if (state.step === 3) return nearestRipeTree();
    if (state.step === 4) return coopPos;
    if (state.order && state.order.active && !state.order.done)
        return state.cacaoKg > 0 ? coopPos : nearestRipeTree();
    return null;
}

/* ---------- Commande exportateur ---------- */
const orderBubble = document.getElementById('orderBubble');
const obBody = document.getElementById('obBody');
state.order = { target: 0, progress: 0, active: false, done: false };
let orderFirstDone = false;

function activateOrder(target) {
    state.order = { target, progress: 0, active: true, done: false };
    orderBubble.classList.remove('hidden', 'done');
    updateOrderBubble();
}
function updateOrderBubble() {
    obBody.textContent = `Cacao tracé : ${state.order.progress} / ${state.order.target} kg`;
}
function addTracedToOrder(kg) {
    if (!state.order.active || state.order.done) return;
    state.order.progress += kg;
    updateOrderBubble();
    if (state.order.progress >= state.order.target) completeOrder();
}
function completeOrder() {
    state.order.done = true;
    const bonus = 50000;
    state.cardBalance += bonus;
    addScore(40);
    sfx.success();
    truckPop = 1;
    orderBubble.classList.add('done');
    obBody.textContent = `Livré ✓  +${formatFCFA(bonus)}`;
    if (!orderFirstDone) {
        orderFirstDone = true;
        showInfo('🚛', 'Commande exportateur livrée',
            "L'exportateur n'accepte que du cacao tracé et « zéro déforestation » : c'est la clé de l'accès " +
            "au marché européen (EUDR). Ta traçabilité complète a permis d'exporter ce lot, et une prime a été " +
            "versée sur ta Carte. Continue à livrer des lots tracés !");
    }
    setTimeout(() => activateOrder(Math.round(state.order.target * 1.5)), 2600);
}

/* ---------- Boucle ---------- */
const clock = new THREE.Clock();
let clockTime = 0, walkPhase = 0;

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    clockTime += dt;

    let mx = input.x, my = input.y;
    if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) my += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;

    let moveX = mx + my, moveZ = my - mx;
    const len = Math.hypot(moveX, moveZ);
    const canMove = state.started && !state.busy;
    if (len > 0.05 && canMove) {
        moveX /= len; moveZ /= len;
        const speed = PLAYER_SPEED * Math.min(1, Math.hypot(mx, my));
        player.position.x = THREE.MathUtils.clamp(player.position.x + moveX * speed * dt, -24, 16);
        player.position.z = THREE.MathUtils.clamp(player.position.z + moveZ * speed * dt, -23, 14);
        player.rotation.y = Math.atan2(moveX, moveZ);
        walkPhase += dt * 12;
        legL.rotation.x = Math.sin(walkPhase) * 0.6;
        legR.rotation.x = -Math.sin(walkPhase) * 0.6;
        torso.position.y = 1.1 + Math.abs(Math.sin(walkPhase)) * 0.05;
    } else {
        legL.rotation.x *= 0.8; legR.rotation.x *= 0.8;
    }

    // Capture des bornes (géolocalisation) par proximité
    if (state.started && !state.plotRegistered) {
        for (let i = 0; i < bornes.length; i++) {
            const b = bornes[i];
            if (!b.visited && player.position.distanceTo(b.position) < BORNE_RADIUS) {
                b.visited = true;
                b.flag.material.color.set(0x22c55e); // rouge → vert
                state.bornesVisited++;
                sfx.coin();
                floaty(`Borne ${state.bornesVisited}/4 ✓`, 0x22d3ee);
                if (state.step === 1) updateObjective();
                if (state.bornesVisited === 4) registerPlot();
            }
        }
    }

    // Repousse des cabosses
    for (const tree of cacaoTrees)
        for (const pod of tree.pods)
            if (!pod.ripe && clockTime >= pod.regrowAt) { pod.ripe = true; pod.mesh.visible = true; }

    // Fèves volantes vers le joueur
    for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i];
        f.t += dt / 0.45;
        const to = new THREE.Vector3(player.position.x, 1.4, player.position.z);
        f.mesh.position.lerpVectors(f.from, to, Math.min(1, f.t));
        f.mesh.scale.setScalar(1 - 0.6 * Math.min(1, f.t));
        if (f.t >= 1) { scene.remove(f.mesh); flyers.splice(i, 1); sfx.collect(); }
    }

    // Drapeaux face caméra
    for (const b of bornes) b.flag.lookAt(camera.position);

    // Camion : léger balancement + pop de livraison
    truck.position.y = truckBaseY + Math.sin(clockTime * 1.6) * 0.03;
    if (truckPop > 0.001) { truckPop *= 0.9; truck.scale.setScalar(1 + 0.15 * truckPop); }
    else truck.scale.setScalar(1);

    // Flèche + chemin de guidage vers l'objectif courant
    const target = (state.started && !state.busy) ? objectiveTarget() : null;
    if (target && player.position.distanceTo(target) > 3.2) {
        guideArrow.visible = true;
        guideArrow.position.set(target.x, 3.2 + Math.sin(clockTime * 3) * 0.25, target.z);
        guideArrow.rotation.y += dt * 2;
        guideLine.visible = true;
        guideLine.geometry.setFromPoints([
            new THREE.Vector3(player.position.x, 0.3, player.position.z),
            new THREE.Vector3(target.x, 0.3, target.z)]);
        guideLine.computeLineDistances();
    } else { guideArrow.visible = false; guideLine.visible = false; }

    // Bulle de commande au-dessus du camion
    if (state.started && !state.busy && state.order.active) {
        const s = worldToScreen(new THREE.Vector3(truck.position.x, 3.4, truck.position.z));
        orderBubble.style.left = s.x + 'px';
        orderBubble.style.top = s.y + 'px';
        orderBubble.classList.remove('hidden');
    } else {
        orderBubble.classList.add('hidden');
    }

    tickHUD(dt);

    camera.position.copy(player.position).add(CAM_OFFSET);
    camera.lookAt(player.position.x, 1, player.position.z);

    updateNearestInteraction();
    renderer.render(scene, camera);
}
animate();

/* ---------- Démarrage ---------- */
const startScreen = document.getElementById('startScreen');
document.getElementById('startBtn').addEventListener('click', () => {
    initAudio();
    state.started = true;
    startScreen.classList.add('hidden');
    updateHUD(); updateObjective();
});
updateHUD(); updateObjective();

/* ---------- Hook de test (inoffensif) ---------- */
window.__dbg = () => ({
    player: [player.position.x.toFixed(1), player.position.z.toFixed(1)],
    interaction: currentInteraction ? currentInteraction.label : null,
    step: state.step, bornes: state.bornesVisited, plot: state.plotRegistered,
    card: state.hasCard, cacaoKg: state.cacaoKg, cardBalance: state.cardBalance,
    mobileMoney: state.mobileMoney, score: state.score, busy: state.busy,
    order: state.order, orderBubbleHidden: orderBubble.classList.contains('hidden'),
    logoVisible: !!document.getElementById('logo'),
});
