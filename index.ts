/*
 * Vencord, a Discord client mod
 * CursorPet user plugin (dog / cat)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import definePlugin, { OptionType } from "@utils/types";

import style from "./styles.css?managed";

// ----------------- Settings -----------------

type AnimalType = "dog" | "cat";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Show the cursor-chasing pet",
        default: true,
    },
    animal: {
        type: OptionType.SELECT,
        description: "Which pet should chase your cursor?",
        default: "dog" as AnimalType,
        options: [
            {
                label: "Dog",
                value: "dog",
            },
            {
                label: "Cat",
                value: "cat",
            },
        ],
    },
    sleepTimeout: {
        type: OptionType.SLIDER,
        description: "Time (seconds) of no mouse movement before the pet falls asleep",
        markers: [3, 5, 10, 20],
        default: 5,
        stickToMarkers: false,
        componentProps: {
            onValueRender: (v: number): string => `${v.toFixed(0)}s`,
        },
    },
    followSmoothness: {
        type: OptionType.SLIDER,
        description: "How strongly the pet chases the cursor (higher = snappier)",
        markers: [0.08, 0.12, 0.18, 0.24],
        default: 0.16,
        stickToMarkers: false,
        componentProps: {
            onValueRender: (v: number): string => v.toFixed(2),
        },
    },
});

// ----------------- Animation state -----------------

type PetState = "running" | "idle" | "sleeping";

let petRoot: HTMLDivElement | null = null;   // The transform root which we move with translate3d
let petSprite: HTMLDivElement | null = null; // The visual pet element

let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let petX = mouseX;
let petY = mouseY;

let currentState: PetState = "idle";
let currentAnimal: AnimalType = "dog";

let lastMouseMoveTime = performance.now();
let lastFrameTime = performance.now();

let rafId: number | null = null;
let mouseMoveListener: ((e: MouseEvent) => void) | null = null;
let initialized = false;

// ----------------- Helpers -----------------

function createPetOverlay() {
    if (petRoot) return;

    const root = document.createElement("div");
    root.className = "vc-cursor-pet-overlay";

    const sprite = document.createElement("div");
    sprite.className = "vc-cursor-pet-sprite vc-cursor-pet-dog vc-cursor-pet-idle";
    sprite.setAttribute("aria-hidden", "true");

    root.appendChild(sprite);
    document.body.appendChild(root);

    petRoot = root;
    petSprite = sprite;
}

function destroyPetOverlay() {
    if (petRoot && petRoot.parentNode) {
        petRoot.parentNode.removeChild(petRoot);
    }
    petRoot = null;
    petSprite = null;
}

/**
 * Update the sprite classes to reflect the chosen animal (dog/cat).
 */
function syncSpriteAnimal() {
    if (!petSprite) return;

    const desired = (settings.store.animal as AnimalType | undefined) ?? "dog";

    if (desired === currentAnimal && petSprite.classList.contains(`vc-cursor-pet-${desired}`)) {
        return;
    }

    petSprite.classList.remove("vc-cursor-pet-dog", "vc-cursor-pet-cat");
    petSprite.classList.add(desired === "dog" ? "vc-cursor-pet-dog" : "vc-cursor-pet-cat");
    currentAnimal = desired;
}

/**
 * Update the sprite class to reflect a new behavioral state.
 */
function setPetState(state: PetState) {
    if (!petSprite || state === currentState) return;

    petSprite.classList.remove(
        "vc-cursor-pet-running",
        "vc-cursor-pet-idle",
        "vc-cursor-pet-sleeping",
    );

    switch (state) {
        case "running":
            petSprite.classList.add("vc-cursor-pet-running");
            break;
        case "idle":
            petSprite.classList.add("vc-cursor-pet-idle");
            break;
        case "sleeping":
            petSprite.classList.add("vc-cursor-pet-sleeping");
            break;
    }

    currentState = state;
}

/**
 * Mouse move handler – tracks the latest cursor position and updates
 * the timestamp for inactivity detection.
 */
function onMouseMove(e: MouseEvent) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    lastMouseMoveTime = performance.now();
}

/**
 * Main animation loop using requestAnimationFrame.
 * Moves the pet towards the cursor with easing and updates animation state.
 */
function animationLoop() {
    rafId = window.requestAnimationFrame(animationLoop);

    const now = performance.now();
    const dt = Math.min((now - lastFrameTime) / 16.6667, 2); // Normalize vs ~60fps
    lastFrameTime = now;

    if (!petRoot || !petSprite) return;

    // Respect setting: hide the pet if disabled, but keep the loop alive so
    // re-enabling works immediately.
    if (!settings.store.enabled) {
        petRoot.style.opacity = "0";
        return;
    } else {
        petRoot.style.opacity = "1";
    }

    // Make sure the sprite has the correct animal class, so switching
    // dog/cat in settings takes effect live.
    syncSpriteAnimal();

    // Smooth follow using a simple lerp towards the mouse position.
    const smoothness = settings.store.followSmoothness ?? 0.16;
    const lerpFactor = Math.max(0.02, Math.min(0.6, smoothness)) * dt;

    const dx = mouseX - petX;
    const dy = mouseY - petY;
    const dist = Math.hypot(dx, dy);

    petX += dx * lerpFactor;
    petY += dy * lerpFactor;

    // Move the transform root. The sprite itself is centered via CSS.
    petRoot.style.transform = `translate3d(${petX}px, ${petY}px, 0)`;

    // Determine behavioral state.
    const idleDistance = 25;
    const runDistance = 80;

    const sleepTimeoutMs =
        (settings.store.sleepTimeout ?? 5) * 1000;

    const inactiveFor = now - lastMouseMoveTime;

    let nextState: PetState;

    if (inactiveFor >= sleepTimeoutMs) {
        nextState = "sleeping";
    } else if (dist > runDistance) {
        nextState = "running";
    } else if (dist > idleDistance) {
        // In-between range can still be considered "running" but slower
        nextState = "running";
    } else {
        nextState = "idle";
    }

    setPetState(nextState);
}

/**
 * Initialize DOM overlay, mouse listener, and start the RAF loop.
 */
function initIfNeeded() {
    if (initialized) return;

    // Wait for <body> to exist if needed
    if (!document.body) {
        const ready = () => {
            document.removeEventListener("DOMContentLoaded", ready);
            initIfNeeded();
        };
        document.addEventListener("DOMContentLoaded", ready);
        return;
    }

    createPetOverlay();

    mouseX = window.innerWidth / 2;
    mouseY = window.innerHeight / 2;
    petX = mouseX;
    petY = mouseY;
    lastMouseMoveTime = performance.now();
    lastFrameTime = performance.now();
    currentState = "idle";

    syncSpriteAnimal();

    mouseMoveListener = onMouseMove;
    window.addEventListener("mousemove", mouseMoveListener, { passive: true });

    if (rafId == null) {
        rafId = window.requestAnimationFrame(animationLoop);
    }

    initialized = true;
}

/**
 * Fully tears down the overlay and all listeners.
 */
function cleanup() {
    if (mouseMoveListener) {
        window.removeEventListener("mousemove", mouseMoveListener);
        mouseMoveListener = null;
    }
    if (rafId != null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
    }

    destroyPetOverlay();
    initialized = false;
}

// ----------------- Plugin definition -----------------

export default definePlugin({
    name: "CursorPet",
    description: "Adds a small dog or cat that chases your mouse cursor around Discord.",
    authors: [
        {
            name: "Your Name Here",
            id: 123456789012345678n, // replace with your actual user ID if you want
        },
    ],

    tags: ["fun", "cosmetic", "cursor", "overlay", "pet"],

    settings,

    start() {
        enableStyle(style);
        initIfNeeded();
    },

    stop() {
        cleanup();
        disableStyle(style);
    },
});
