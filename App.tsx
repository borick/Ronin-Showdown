import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, RotateCcw, Shield, Sword, User, Skull, Trophy, Users, Wifi } from 'lucide-react';

// ============================================================================
// EXTERNAL LIBS
// ============================================================================

declare var Peer: any; // PeerJS global

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const W = 1200;
const H = 700;
const TEAM_RED = { r: 220, g: 60, b: 60 };
const TEAM_BLUE = { r: 70, g: 120, b: 230 };

const STANCE = {
  HIGH: "HIGH",
  MID: "MID",
  LOW: "LOW"
} as const;

type StanceType = keyof typeof STANCE;

const STANCE_DATA = {
  [STANCE.HIGH]: { guard_y: -22, guard_in: 14, guard_strength: 0.98 },
  [STANCE.MID]: { guard_y: -6, guard_in: 18, guard_strength: 1.00 },
  [STANCE.LOW]: { guard_y: 10, guard_in: 22, guard_strength: 0.88 },
};

// ============================================================================
// MATH UTILS
// ============================================================================

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const v_lerp = (a: number[], b: number[], t: number) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const vec_add = (a: number[], b: number[]) => [a[0] + b[0], a[1] + b[1]];
const vec_sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1]];
const vec_mul = (a: number[], s: number) => [a[0] * s, a[1] * s];
const vec_len = (a: number[]) => Math.hypot(a[0], a[1]);
const vec_norm = (a: number[]) => {
  const l = vec_len(a);
  return l < 1e-6 ? [0, 0] : [a[0] / l, a[1] / l];
};
const rot = (v: number[], ang: number) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
};
const angle_of = (v: number[]) => Math.atan2(v[1], v[0]);
const angle_diff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const smoothstep = (t: number) => {
  t = clamp(t, 0.0, 1.0);
  return t * t * (3 - 2 * t);
};

// ============================================================================
// GAME CLASSES
// ============================================================================

interface MoveDef {
  name: string;
  stance: StanceType | "ANY";
  total: number;
  windup: number;
  active: number;
  recover: number;
  reach: number;
  dmg: number;
  arc: number;
  style: "slash" | "thrust" | "overhead" | "low" | "kick" | "feint";
  atk_height: StanceType;
  guard_break: number;
  knock: number;
  is_kick?: boolean;
  is_feint?: boolean;
}

const MOVES: MoveDef[] = [
  { name: "Men Uchi", stance: "MID", total: 0.52, windup: 0.16, active: 0.16, recover: 0.20, reach: 92, dmg: 10, arc: 0.92, style: "slash", atk_height: "MID", guard_break: 0.06, knock: 0.02 },
  { name: "Tsuki", stance: "MID", total: 0.62, windup: 0.22, active: 0.14, recover: 0.26, reach: 112, dmg: 13, arc: 0.36, style: "thrust", atk_height: "MID", guard_break: 0.10, knock: 0.06 },
  { name: "Jodan Kesa", stance: "HIGH", total: 0.84, windup: 0.34, active: 0.18, recover: 0.32, reach: 102, dmg: 20, arc: 0.70, style: "overhead", atk_height: "HIGH", guard_break: 0.22, knock: 0.12 },
  { name: "Low Sweep", stance: "LOW", total: 0.70, windup: 0.26, active: 0.18, recover: 0.26, reach: 88, dmg: 11, arc: 0.85, style: "low", atk_height: "LOW", guard_break: 0.35, knock: 0.12 },
  { name: "Front Kick", stance: "ANY", total: 0.52, windup: 0.18, active: 0.14, recover: 0.20, reach: 66, dmg: 6, arc: 0.55, style: "kick", atk_height: "LOW", guard_break: 0.75, knock: 0.42, is_kick: true },
];

class Spark {
  pos: number[];
  vel: number[];
  life: number;
  maxLife: number;
  t: number;
  col: string;

  constructor(pos: number[], vel: number[], life: number, col: string) {
    this.pos = [...pos];
    this.vel = [...vel];
    this.life = life;
    this.maxLife = life;
    this.t = 0;
    this.col = col;
  }

  update(dt: number) {
    this.t += dt;
    this.pos[0] += this.vel[0] * dt;
    this.pos[1] += this.vel[1] * dt;
    // Drag
    this.vel[0] *= Math.pow(0.92, dt * 60);
    this.vel[1] *= Math.pow(0.92, dt * 60);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const a = 1.0 - clamp(this.t / this.maxLife, 0.0, 1.0);
    const r = Math.max(1, 3 * a);
    ctx.fillStyle = this.col;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(this.pos[0], this.pos[1], r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  dead() {
    return this.t >= this.life;
  }
}

interface SerializedSamurai {
    p: number[];
    v: number[];
    hp: number;
    ghp: number;
    s: string;
    st: number;
    fd: number[];
    stc: StanceType;
    m: number;
    mt: number;
    cd: number;
    dead: boolean;
}

class Samurai {
  team: string;
  isPlayer: boolean;
  color: { r: number, g: number, b: number };
  pos: number[];
  vel: number[];
  hp: number;
  maxHp: number;
  guard_hp: number;
  stagger: number;
  dead: boolean;
  
  // State
  state: "idle" | "move" | "attack" | "recover" | "block" | "hitstun" | "dead" | "dash";
  state_t: number;
  facing_dir: number[];
  stance: StanceType;
  
  // Combat
  move: MoveDef | null;
  move_t: number;
  hit_registry: Set<Samurai>;
  cooldown: number;
  
  // Defense
  guard_value: number; // Visual lift of sword
  block_t: number;
  parry_window: number;
  
  // AI specific
  assigned_target: Samurai | null;
  ai_aggression: number;
  ai_timer: number;
  
  // Animation props
  walk_phase: number;
  breath: number;
  debug_pts: any;

  // Stats
  statSpeed: number;
  statPower: number;

  constructor(team: string, pos: number[], isPlayer: boolean, stats: { speed: number, power: number } = { speed: 1, power: 1 }) {
    this.team = team;
    this.isPlayer = isPlayer;
    this.color = team === "red" ? TEAM_RED : TEAM_BLUE;
    this.pos = [...pos];
    this.vel = [0, 0];
    this.hp = 100;
    this.maxHp = 100;
    this.guard_hp = 1.0;
    this.stagger = 0;
    this.dead = false;
    
    this.state = "idle";
    this.state_t = 0;
    this.facing_dir = [1, 0];
    this.stance = STANCE.MID;
    
    this.move = null;
    this.move_t = 0;
    this.hit_registry = new Set();
    this.cooldown = 0;
    
    this.guard_value = 0;
    this.block_t = 0;
    this.parry_window = 0;
    
    this.assigned_target = null;
    this.ai_aggression = Math.random() * 0.5 + 0.5;
    this.ai_timer = 0;
    
    this.walk_phase = Math.random() * Math.PI * 2;
    this.breath = Math.random() * Math.PI * 2;
    this.debug_pts = {};

    this.statSpeed = stats.speed;
    this.statPower = stats.power;
  }

  serialize(): SerializedSamurai {
      return {
          p: this.pos,
          v: this.vel,
          hp: this.hp,
          ghp: this.guard_hp,
          s: this.state,
          st: this.state_t,
          fd: this.facing_dir,
          stc: this.stance,
          m: this.move ? MOVES.indexOf(this.move) : -1,
          mt: this.move_t,
          cd: this.cooldown,
          dead: this.dead
      }
  }

  deserialize(data: SerializedSamurai) {
      this.pos = data.p;
      this.vel = data.v;
      this.hp = data.hp;
      this.guard_hp = data.ghp;
      this.state = data.s as any;
      this.state_t = data.st;
      this.facing_dir = data.fd;
      this.stance = data.stc;
      if (data.m !== -1) {
          this.move = MOVES[data.m];
      } else {
          this.move = null;
      }
      this.move_t = data.mt;
      this.cooldown = data.cd;
      this.dead = data.dead;
  }

  isAlive() { return !this.dead && this.hp > 0; }
  ground() { return this.pos; }
  center() { return [this.pos[0], this.pos[1] - 78]; }

  // IK Solver
  solveIK(root: number[], target: number[], l1: number, l2: number, bendSign: number) {
    const r2t = vec_sub(target, root);
    const d = vec_len(r2t);
    const d_clamped = clamp(d, Math.abs(l1 - l2) + 0.001, l1 + l2 - 0.001);
    
    let cos_a = (l1*l1 + d_clamped*d_clamped - l2*l2) / (2*l1*d_clamped);
    cos_a = clamp(cos_a, -1, 1);
    const a = Math.acos(cos_a);
    const base_ang = angle_of(r2t);
    const elbow_ang = base_ang + bendSign * a;
    
    let elbow = vec_add(root, rot([l1, 0], elbow_ang));
    
    // Leg straightening logic
    const reach = l1 + l2;
    const straighten = clamp((d / reach - 0.78) / 0.22, 0.0, 1.0);
    if (straighten > 0) {
      const n = vec_norm(r2t);
      const elbow_straight = vec_add(root, vec_mul(n, l1));
      elbow = v_lerp(elbow, elbow_straight, straighten);
    }

    return { elbow, hand: target };
  }

  update(dt: number, input: any, enemies: Samurai[], allies: Samurai[], sparks: Spark[]) {
    if (this.dead) return;

    // Timers
    this.move_t += dt;
    this.state_t += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    this.parry_window = Math.max(0, this.parry_window - dt);
    
    // Friction
    this.vel[0] *= Math.pow(0.86, dt * 60);
    this.vel[1] *= Math.pow(0.86, dt * 60);
    this.pos[0] += this.vel[0] * dt;
    this.pos[1] += this.vel[1] * dt;
    
    // Boundaries
    this.pos[0] = clamp(this.pos[0], 40, W - 40);
    this.pos[1] = clamp(this.pos[1], 150, H - 40);

    // Guard regen
    if (this.state !== "block" && this.state !== "attack" && this.state !== "hitstun") {
        this.guard_hp = Math.min(1.0, this.guard_hp + dt * 0.15);
    }
    this.guard_value = Math.max(0, this.guard_value - dt * 2);

    // State Machine
    if (this.state === "hitstun") {
        if (this.state_t > (0.2 + this.stagger * 0.4)) {
            this.state = "idle";
        }
        return;
    }

    if (this.state === "attack") {
        if (this.move && this.move_t >= this.move.total / this.statSpeed) {
            this.state = "recover";
            this.state_t = 0;
            this.cooldown = this.move.recover / this.statSpeed;
        }
        return;
    }

    if (this.state === "recover") {
        if (this.state_t > 0.15) this.state = "idle";
        return;
    }

    if (this.state === "dash") {
        if (this.state_t > 0.2) {
            this.state = "idle";
            this.vel = [0,0];
        }
        return;
    }

    if (this.state === "block") {
        this.guard_value = 1.0;
        this.vel = vec_mul(this.vel, 0.5);
        // Player holds block, AI uses timer
        if (this.isPlayer) {
            if (!input.block) this.state = "idle";
        } else {
            if (this.state_t > this.block_t) this.state = "idle";
        }
    }

    // Input Processing
    if (this.isPlayer) {
        // Movement
        const speed = 280 * this.statSpeed;
        let dx = 0, dy = 0;
        if (input.keys["w"]) dy -= 1;
        if (input.keys["s"]) dy += 1;
        if (input.keys["a"]) dx -= 1;
        if (input.keys["d"]) dx += 1;
        
        if (dx !== 0 || dy !== 0) {
            const mag = Math.hypot(dx, dy);
            dx /= mag; dy /= mag;
            this.vel[0] += dx * speed * dt;
            this.vel[1] += dy * speed * dt;
            if (this.state === "idle") this.state = "move";
        } else if (this.state === "move") {
            this.state = "idle";
        }

        // Mouse Aim
        const rect = document.querySelector('canvas')?.getBoundingClientRect();
        if (rect && input.mouse) {
            const mx = input.mouse[0] - rect.left;
            const my = input.mouse[1] - rect.top;
            const toMouse = vec_sub([mx, my], this.ground());
            this.facing_dir = vec_norm(toMouse);
        }

        // Actions
        if (this.cooldown <= 0) {
            if (input.dash) {
                this.state = "dash";
                this.state_t = 0;
                this.vel = vec_mul(this.facing_dir, 900);
                this.cooldown = 0.5;
            } else if (input.attack) {
                // Random attack based on mouse height for flavor, or just cycle
                // For simplicity, let's map attack type to distance or just random
                const m = input.keys["shift"] ? MOVES[4] : (Math.random() > 0.5 ? MOVES[0] : MOVES[2]); 
                this.startAttack(m);
                // NOTE: We don't consume input.attack here by modifying input object
                // because input object might be reused/sent over network.
                // It is handled by the caller resetting the trigger.
            } else if (input.block) {
                this.state = "block";
                this.state_t = 0;
                // Parry window at start of block
                this.parry_window = 0.15;
            }
        }
    } else {
        // AI Logic
        this.updateAI(dt, enemies, allies);
    }
  }

  updateAI(dt: number, enemies: Samurai[], allies: Samurai[]) {
    // Simple formation AI
    const target = enemies[0]; // Player is usually 0
    if (!target || !target.isAlive()) return;

    this.ai_timer -= dt;

    const toTarget = vec_sub(target.ground(), this.ground());
    const dist = vec_len(toTarget);
    
    // Face target
    if (dist > 10) this.facing_dir = vec_norm(toTarget);

    // Spacing with ally
    let push = [0, 0];
    allies.forEach(ally => {
        if (ally === this) return;
        const toAlly = vec_sub(this.ground(), ally.ground());
        const d = vec_len(toAlly);
        if (d < 100) {
            const n = vec_norm(toAlly);
            push = vec_add(push, vec_mul(n, 400 * dt));
        }
    });
    this.vel = vec_add(this.vel, push);

    // Behavior
    const desiredDist = 110;
    
    if (this.state === "idle" || this.state === "move") {
        if (dist > desiredDist + 20) {
            const dir = vec_norm(toTarget);
            this.vel[0] += dir[0] * 200 * dt;
            this.vel[1] += dir[1] * 200 * dt;
            this.state = "move";
        } else if (dist < desiredDist - 20) {
             const dir = vec_norm(toTarget);
            this.vel[0] -= dir[0] * 200 * dt;
            this.vel[1] -= dir[1] * 200 * dt;
            this.state = "move";
        } else {
            // Circling
            const p = [-this.facing_dir[1], this.facing_dir[0]];
            this.vel[0] += p[0] * 100 * dt;
            this.vel[1] += p[1] * 100 * dt;
            this.state = "idle";
        }

        // Attack Decision
        if (this.cooldown <= 0 && this.ai_timer <= 0) {
            if (dist < 130 && Math.random() < 0.05 * this.ai_aggression) {
                const moves = MOVES;
                const m = moves[Math.floor(Math.random() * moves.length)];
                this.startAttack(m);
                this.ai_timer = Math.random() * 1.5 + 0.5;
            } else if (Math.random() < 0.02) {
                // Random block
                this.state = "block";
                this.block_t = Math.random() * 0.5 + 0.2;
                this.parry_window = 0.1;
                this.ai_timer = 1.0;
            }
        }
    }
  }

  startAttack(m: MoveDef) {
    this.move = m;
    this.move_t = 0;
    this.state = "attack";
    this.state_t = 0;
    this.hit_registry.clear();
    this.cooldown = 0;
    // Boost power stats
    if (this.isPlayer) {
        // Adjust damage by power stat
    }
  }

  takeHit(dmg: number, guard_break: number, knock: number, attackerDir: number[], sparks: Spark[]): "hit" | "blocked" | "parry" {
    // Check Parry
    if (this.state === "block" && this.parry_window > 0) {
        // Successful parry
        this.guard_hp = Math.min(1.0, this.guard_hp + 0.2);
        this.cooldown = 0;
        this.state = "idle";
        // Visuals
        for(let i=0; i<8; i++) {
             sparks.push(new Spark(this.center(), [Math.random()*400-200, Math.random()*400-200], 0.2, "#ffffaa"));
        }
        return "parry";
    }

    // Check Block
    if (this.state === "block" && this.guard_hp > 0) {
        this.guard_hp -= guard_break;
        this.stagger = 0.2;
        this.vel = vec_add(this.vel, vec_mul(attackerDir, 100));
        
        // Block sparks
        for(let i=0; i<5; i++) {
             sparks.push(new Spark(this.center(), [Math.random()*200-100, Math.random()*200-100], 0.15, "#aaaa55"));
        }
        
        if (this.guard_hp <= 0) {
            this.state = "hitstun";
            this.stagger = 1.0; // Guard break
            return "hit"; // Treated as hit logic for stun
        }
        return "blocked";
    }

    // Hit
    this.hp -= dmg / (this.isPlayer ? 1 : 1); // Player slightly tougher?
    this.state = "hitstun";
    this.state_t = 0;
    this.stagger = 0.4;
    this.vel = vec_add(this.vel, vec_mul(attackerDir, 300 * (1+knock)));
    
    // Blood sparks
    for(let i=0; i<8; i++) {
        sparks.push(new Spark(this.center(), [Math.random()*300-150, Math.random()*300-150], 0.3, "#cc2222"));
    }

    if (this.hp <= 0) {
        this.dead = true;
        this.hp = 0;
    }

    return "hit";
  }

  // Visuals
  computePose(dt: number) {
    const speed = Math.hypot(this.vel[0], this.vel[1]);
    const walk = clamp(speed / 260.0, 0.0, 1.0);
    this.walk_phase += dt * (2.8 + 5.2 * walk);
    this.breath += dt * 1.5;

    const ground = this.ground();
    const bob = Math.sin(this.breath) * 0.9 + Math.sin(this.walk_phase * 0.5) * 0.55 * walk;
    const sway = Math.sin(this.walk_phase) * 1.7 * walk;

    // Feet
    const stride = 12 * walk;
    const ph = Math.sin(this.walk_phase);
    const foot_y = ground[1];
    const footL = [ground[0] - 10 + ph * stride * 0.9, foot_y - Math.max(0, -ph) * 6 * walk];
    const footR = [ground[0] + 10 - ph * stride * 0.9, foot_y - Math.max(0, ph) * 6 * walk];

    // Body
    const hip = [ground[0], ground[1] - 54 + bob];
    const chest = [ground[0] + sway * 0.22, ground[1] - 90 + bob];
    const head = [chest[0], chest[1] - 18];

    // Orientation
    const fd = this.facing_dir;
    const front_is_right = fd[0] >= 0; // Simple approximation for IK side choice

    const shL = [chest[0] - 14, chest[1] - 2];
    const shR = [chest[0] + 14, chest[1] - 2];
    const front_sh = front_is_right ? shR : shL;
    const rear_sh = front_is_right ? shL : shR;

    // Leg IK
    const leg_u = 34, leg_l = 32;
    const hipL = [hip[0] - 11, hip[1]];
    const hipR = [hip[0] + 11, hip[1]];
    const ikL = this.solveIK(hipL, footL, leg_u, leg_l, 1);
    const ikR = this.solveIK(hipR, footR, leg_u, leg_l, 1);

    // Arm Targets (Procedural Animation)
    let front_target = [chest[0] + fd[0] * 20, chest[1] + 10];
    let rear_target = [chest[0] - fd[0] * 10, chest[1] + 10];

    const sd = STANCE_DATA[this.stance];
    const guard_center = [chest[0] + fd[0] * sd.guard_in, chest[1] + 6 + sd.guard_y];
    
    front_target = [guard_center[0] + fd[0]*18, guard_center[1] + fd[1]*6];
    rear_target = [guard_center[0] - fd[0]*6, guard_center[1] - fd[1]*2 + 10];

    // Attack Override
    let activeRatio = 0;
    if (this.state === "attack" && this.move) {
        const m = this.move;
        const total = m.total / this.statSpeed;
        const windup = m.windup / this.statSpeed;
        const active = m.active / this.statSpeed;
        
        const perp = [-fd[1], fd[0]];
        const t = this.move_t;
        
        if (t < windup) {
            // Windup
            const u = smoothstep(t / windup);
            if (m.style === "slash") {
                 front_target = vec_add(chest, vec_add(vec_mul(perp, 20), vec_mul(fd, -10)));
                 front_target[1] -= 30;
            } else if (m.style === "overhead") {
                front_target = [chest[0], chest[1] - 60];
            } else if (m.style === "thrust") {
                front_target = vec_add(chest, vec_mul(fd, -20));
            }
        } else if (t < windup + active) {
            // Active
            activeRatio = 1.0;
            const u = smoothstep((t - windup) / active);
            if (m.style === "slash") {
                 const start = vec_add(chest, vec_add(vec_mul(perp, 20), vec_mul(fd, -10)));
                 start[1] -= 30;
                 const end = vec_add(chest, vec_add(vec_mul(perp, -20), vec_mul(fd, 60)));
                 end[1] += 20;
                 front_target = v_lerp(start, end, u);
            } else if (m.style === "overhead") {
                const start = [chest[0], chest[1] - 60];
                const end = [chest[0] + fd[0]*50, chest[1] + 50];
                 front_target = v_lerp(start, end, u);
            } else if (m.style === "thrust") {
                 const start = vec_add(chest, vec_mul(fd, -20));
                 const end = vec_add(chest, vec_mul(fd, 80));
                 front_target = v_lerp(start, end, u);
            }
        }
    } else if (this.state === "block") {
         front_target = [chest[0] + fd[0]*15, chest[1] - 15];
         rear_target = [chest[0] - fd[0]*10, chest[1] + 10];
    } else if (this.state === "hitstun") {
         front_target = [chest[0] - fd[0]*10, chest[1] - 10];
         rear_target = [chest[0] - fd[0]*10, chest[1] + 20];
    }

    // Arm IK
    const arm_u = 26, arm_l = 24;
    const ikFront = this.solveIK(front_sh, front_target, arm_u, arm_l, front_is_right ? -1 : 1);
    const ikRear = this.solveIK(rear_sh, rear_target, arm_u, arm_l, front_is_right ? 1 : -1);

    // Store for rendering
    this.debug_pts = {
        ground, hip, chest, head, footL, footR,
        kneeL: ikL.elbow, kneeR: ikR.elbow,
        shL, shR,
        handFront: ikFront.hand, elbowFront: ikFront.elbow,
        handRear: ikRear.hand, elbowRear: ikRear.elbow,
        activeRatio,
        fd
    };
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.dead) {
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.arc(this.pos[0], this.pos[1], 15, 0, Math.PI*2);
        ctx.fill();
        return;
    }

    const pts = this.debug_pts;
    if (!pts.chest) return;

    const rgb = this.color;
    const colMain = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    const colDark = `rgb(${rgb.r*0.6}, ${rgb.g*0.6}, ${rgb.b*0.6})`;

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(pts.ground[0], pts.ground[1], 20, 8, 0, 0, Math.PI*2);
    ctx.fill();

    // Legs
    ctx.strokeStyle = colDark;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    // L
    ctx.beginPath(); ctx.moveTo(pts.hip[0]-6, pts.hip[1]); ctx.lineTo(pts.kneeL[0], pts.kneeL[1]); ctx.lineTo(pts.footL[0], pts.footL[1]); ctx.stroke();
    // R
    ctx.beginPath(); ctx.moveTo(pts.hip[0]+6, pts.hip[1]); ctx.lineTo(pts.kneeR[0], pts.kneeR[1]); ctx.lineTo(pts.footR[0], pts.footR[1]); ctx.stroke();

    // Torso
    ctx.strokeStyle = colMain;
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(pts.hip[0], pts.hip[1]); ctx.lineTo(pts.chest[0], pts.chest[1]); ctx.stroke();

    // Head
    ctx.fillStyle = colDark;
    ctx.beginPath(); ctx.arc(pts.head[0], pts.head[1], 11, 0, Math.PI*2); ctx.fill();
    // Visor
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pts.head[0]+pts.fd[0]*8, pts.head[1]-2); ctx.lineTo(pts.head[0]+pts.fd[0]*8, pts.head[1]+2); ctx.stroke();

    // Arms (Rear first)
    const drawArm = (sh: number[], el: number[], ha: number[], col: string) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(el[0], el[1]); ctx.lineTo(ha[0], ha[1]); ctx.stroke();
    };

    drawArm(pts.shR, pts.elbowRear, pts.handRear, colDark);
    
    // Sword (Under front arm if inactive, usually)
    const sb = pts.handFront;
    let swordTip = vec_add(sb, vec_mul(pts.fd, 60)); // default forward
    if (this.state === "idle" || this.state === "move") {
        // Guard pose
        swordTip = vec_add(sb, vec_mul([pts.fd[0], -1.5], 40));
    } else {
        // Dynamic based on hand positions logic simplified
         const dir = vec_norm(vec_sub(pts.handFront, pts.handRear));
         swordTip = vec_add(sb, vec_mul(dir, 64));
    }
    
    // Sword Trail
    if (pts.activeRatio > 0) {
        ctx.strokeStyle = "rgba(200, 230, 255, 0.5)";
        ctx.lineWidth = 40 * pts.activeRatio;
        ctx.beginPath(); ctx.moveTo(sb[0], sb[1]); ctx.lineTo(swordTip[0], swordTip[1]); ctx.stroke();
    }

    // Sword Blade
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sb[0], sb[1]); ctx.lineTo(swordTip[0], swordTip[1]); ctx.stroke();

    drawArm(pts.shL, pts.elbowFront, pts.handFront, colMain);

    // UI Bars
    const barW = 60;
    const bx = pts.ground[0] - barW/2;
    const by = pts.ground[1] - 130;
    
    // HP
    ctx.fillStyle = "#333"; ctx.fillRect(bx, by, barW, 6);
    ctx.fillStyle = this.team === "blue" ? "#4488ff" : "#ff4444"; 
    ctx.fillRect(bx, by, barW * (this.hp/this.maxHp), 6);
    
    // Guard
    ctx.fillStyle = "#333"; ctx.fillRect(bx, by+8, barW, 4);
    ctx.fillStyle = "#eeee44"; ctx.fillRect(bx, by+8, barW * this.guard_hp, 4);
  }
}

// ============================================================================
// MAIN REACT COMPONENT
// ============================================================================

type GameState = "MENU" | "MP_MENU" | "MP_LOBBY" | "PLAYING" | "GAME_OVER";
type Winner = "PLAYER" | "AI" | null;
type MP_Role = "HOST" | "CLIENT" | null;

export default function RoninApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>("MENU");
  const [winner, setWinner] = useState<Winner>(null);
  const [playerStats, setPlayerStats] = useState({ speed: 1.0, power: 1.0, type: "BALANCED" });
  
  // MP State
  const [roomCode, setRoomCode] = useState("");
  const [inputRoomCode, setInputRoomCode] = useState("");
  const [mpStatus, setMpStatus] = useState("");

  // Game Engine Refs (Mutable state outside React render cycle)
  const engine = useRef({
    lastTime: 0,
    player: null as Samurai | null,
    enemies: [] as Samurai[],
    sparks: [] as Spark[],
    input: {
        keys: {} as Record<string, boolean>,
        mouse: [0, 0],
        attack: false,
        block: false,
        dash: false
    },
    shake: 0,
    // MP Config
    mode: "SINGLE" as "SINGLE" | "MP",
    mpRole: null as MP_Role,
    peer: null as any,
    conn: null as any,
    remoteInput: null as any
  });

  // Input Listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
        engine.current.input.keys[e.key.toLowerCase()] = true;
        if (e.code === "Space") engine.current.input.dash = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
        engine.current.input.keys[e.key.toLowerCase()] = false;
        if (e.key.toLowerCase() === "q") engine.current.input.block = false; 
    };
    const onMouseDown = (e: MouseEvent) => {
        if (e.button === 0) engine.current.input.attack = true;
        if (e.button === 2) engine.current.input.block = true;
    };
    const onMouseUp = (e: MouseEvent) => {
        if (e.button === 2) engine.current.input.block = false;
    };
    const onMouseMove = (e: MouseEvent) => {
        engine.current.input.mouse = [e.clientX, e.clientY];
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("contextmenu", onContextMenu);

    return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  const initGame = (mode: "SINGLE" | "MP", role: MP_Role = null) => {
    const e = engine.current;
    e.mode = mode;
    e.mpRole = role;

    // P1 (Blue)
    e.player = new Samurai("blue", [200, 400], true, playerStats);
    
    if (mode === "SINGLE") {
        // Spawn 2 AI
        e.enemies = [
            new Samurai("red", [900, 300], false, { speed: 0.9, power: 1.0 }),
            new Samurai("red", [900, 500], false, { speed: 1.1, power: 0.8 })
        ];
    } else {
        // MP 1v1
        // P1 is always Blue (Host)
        // P2 is always Red (Client)
        // If Role is HOST, we control P1. P2 is 'Player' but remote.
        // If Role is CLIENT, we control P2. P1 is 'Player' but remote.
        
        // We set isPlayer=true for both initially to enable input handling logic, 
        // but we will gate the input feed based on role.
        e.player = new Samurai("blue", [300, 400], true, playerStats); // HOST controls this
        e.enemies = [
             new Samurai("red", [900, 400], true, { speed: 1.0, power: 1.0 }) // CLIENT controls this
        ];
    }
    
    e.sparks = [];
    e.shake = 0;
    setGameState("PLAYING");
    setWinner(null);
  };

  const startSinglePlayer = () => initGame("SINGLE");

  const hostGame = () => {
      setMpStatus("Initializing Host...");
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      setRoomCode(code);
      
      const peer = new Peer(`ronin-${code}-host`);
      engine.current.peer = peer;

      peer.on('open', (id: string) => {
          setMpStatus("Waiting for player...");
      });

      peer.on('connection', (conn: any) => {
          engine.current.conn = conn;
          conn.on('data', (data: any) => {
              if (data.type === 'INPUT') {
                  engine.current.remoteInput = data.input;
              }
          });
          setMpStatus("Connected! Starting...");
          setTimeout(() => initGame("MP", "HOST"), 1000);
      });
      
      setGameState("MP_LOBBY");
  };

  const joinGame = () => {
      setMpStatus("Connecting...");
      const peer = new Peer(); // Auto ID
      engine.current.peer = peer;
      
      peer.on('open', () => {
          const conn = peer.connect(`ronin-${inputRoomCode}-host`);
          engine.current.conn = conn;
          
          conn.on('open', () => {
              setMpStatus("Connected! Waiting for host...");
          });

          conn.on('data', (data: any) => {
             if (data.type === 'STATE') {
                 // Game Started / Update
                 if (gameState !== "PLAYING") {
                     // First packet triggers start
                     initGame("MP", "CLIENT");
                 }
                 
                 // Apply State
                 const e = engine.current;
                 if (e.player) e.player.deserialize(data.p1);
                 if (e.enemies[0]) e.enemies[0].deserialize(data.p2);
             }
          });
      });
      
      peer.on('error', (err: any) => {
          setMpStatus("Connection failed. Check code.");
      });
  };

  // Main Loop
  useEffect(() => {
    if (gameState !== "PLAYING") return;
    
    let rAF_ID: number;
    const loop = (timestamp: number) => {
        const e = engine.current;
        if (!e.lastTime) e.lastTime = timestamp;
        const dt = Math.min((timestamp - e.lastTime) / 1000, 0.1); 
        e.lastTime = timestamp;

        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;

        // ===========================================
        // UPDATE LOGIC
        // ===========================================
        
        // Single Player / Host Logic (Authority)
        if (e.mode === "SINGLE" || e.mpRole === "HOST") {
            const entities = [e.player!, ...e.enemies].filter(x => x);
            const aliveEnemies = e.enemies.filter(en => en.isAlive());

            // --- INPUT MAPPING ---
            let p1Input = e.input;
            let p2Input = e.mode === "MP" ? (e.remoteInput || {}) : {};

            // Update P1 (Host/Local)
            if (e.player && e.player.isAlive()) {
                e.player.update(dt, p1Input, aliveEnemies, [], e.sparks);
                
                // P1 Attacks
                if (e.player.state === "attack" && e.player.move) {
                    const m = e.player.move;
                    const frame = e.player.move_t / (m.total / e.player.statSpeed);
                    const startRatio = m.windup / m.total;
                    const endRatio = (m.windup + m.active) / m.total;
                    
                    if (frame >= startRatio && frame <= endRatio) {
                        aliveEnemies.forEach(en => {
                            if (e.player!.hit_registry.has(en)) return;
                            const toEn = vec_sub(en.ground(), e.player!.ground());
                            if (vec_len(toEn) < m.reach + 30) {
                                if (Math.abs(angle_diff(angle_of(toEn), angle_of(e.player!.facing_dir))) < m.arc) {
                                    const res = en.takeHit(m.dmg * e.player!.statPower, m.guard_break, m.knock, e.player!.facing_dir, e.sparks);
                                    e.player!.hit_registry.add(en);
                                    if (res === "parry") {
                                        e.player!.stagger = 0.8; e.player!.state = "hitstun";
                                    } else { e.shake = 5; }
                                }
                            }
                        });
                    }
                }
            }

            // Update Enemies (AI or P2)
            e.enemies.forEach(en => {
                if (en.isAlive()) {
                    // If MP, this is P2 controlled by remote input
                    // If SP, this is AI controlled by empty input (internal AI logic takes over if input empty)
                    // Wait, AI logic is inside update if !isPlayer.
                    // For MP, we set isPlayer=true.
                    
                    en.update(dt, e.mode === "MP" ? p2Input : {}, [e.player!], e.enemies, e.sparks);

                    // Enemy Attacks
                    if (en.state === "attack" && en.move) {
                         const m = en.move;
                         const frame = en.move_t / (m.total / en.statSpeed);
                         const startRatio = m.windup / m.total;
                         const endRatio = (m.windup + m.active) / m.total;
                         
                         if (frame >= startRatio && frame <= endRatio && e.player && e.player.isAlive()) {
                             if (!en.hit_registry.has(e.player)) {
                                 const toPl = vec_sub(e.player.ground(), en.ground());
                                 if (vec_len(toPl) < m.reach + 30) {
                                     if (Math.abs(angle_diff(angle_of(toPl), angle_of(en.facing_dir))) < m.arc) {
                                         const res = e.player.takeHit(m.dmg, m.guard_break, m.knock, en.facing_dir, e.sparks);
                                         en.hit_registry.add(e.player);
                                         if (res === "parry") {
                                             en.stagger = 0.8; en.state = "hitstun";
                                         } else { e.shake = 5; }
                                     }
                                 }
                             }
                         }
                    }
                }
            });

            // FX Update
            e.sparks.forEach(s => s.update(dt));
            e.sparks = e.sparks.filter(s => !s.dead());
            e.shake = Math.max(0, e.shake - dt * 15);

            // Win Condition
            if (e.player?.dead) { setWinner("AI"); setGameState("GAME_OVER"); }
            else if (aliveEnemies.length === 0) { setWinner("PLAYER"); setGameState("GAME_OVER"); }

            // Broadcast State if Host
            if (e.mode === "MP" && e.conn && e.conn.open) {
                e.conn.send({
                    type: 'STATE',
                    p1: e.player?.serialize(),
                    p2: e.enemies[0]?.serialize()
                });
            }

        } else if (e.mode === "MP" && e.mpRole === "CLIENT") {
            // Client Logic: Just send input and render state
            if (e.conn && e.conn.open) {
                e.conn.send({ type: 'INPUT', input: e.input });
            }
            
            // Client relies on incoming data for position updates (handled in connection callback)
            // But we still need to run computePose for smooth rendering
        }

        // ===========================================
        // RENDER LOGIC
        // ===========================================
        
        // Reset inputs that are triggers
        e.input.attack = false;
        e.input.dash = false;
        
        const entities = [e.player!, ...e.enemies].filter(x => x);
        entities.forEach(ent => ent.computePose(dt));

        ctx.fillStyle = "#16161a";
        ctx.fillRect(0, 0, W, H);
        
        ctx.save();
        const shakeX = (Math.random() - 0.5) * e.shake;
        const shakeY = (Math.random() - 0.5) * e.shake;
        ctx.translate(shakeX, shakeY);
        
        ctx.fillStyle = "#1e1e24";
        ctx.fillRect(40, 100, W-80, H-140);
        ctx.strokeStyle = "#2a2a32";
        ctx.lineWidth = 4;
        ctx.strokeRect(40, 100, W-80, H-140);

        entities.sort((a, b) => a.pos[1] - b.pos[1]);
        entities.forEach(ent => ent.draw(ctx));
        e.sparks.forEach(s => s.draw(ctx));

        ctx.restore();

        rAF_ID = requestAnimationFrame(loop);
    };

    rAF_ID = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rAF_ID);
  }, [gameState]);

  return (
    <div className="relative w-full h-screen bg-neutral-900 flex items-center justify-center text-white overflow-hidden select-none">
      <div className="relative border-4 border-neutral-700 rounded-lg shadow-2xl bg-black" style={{ width: W, height: H }}>
        <canvas ref={canvasRef} width={W} height={H} className="block w-full h-full" />
        
        {/* UI OVERLAY */}
        {gameState === "PLAYING" && (
            <div className="absolute top-4 left-4 right-4 flex justify-between pointer-events-none">
                <div className="flex flex-col gap-1">
                    <div className="text-xl font-bold text-blue-400">{engine.current.mode === "MP" ? (engine.current.mpRole === "HOST" ? "YOU (P1)" : "P1 (OPPONENT)") : "PLAYER"}</div>
                    <div className="text-sm text-neutral-400">WASD: Move | LMB: Attack | RMB: Block | SPACE: Dash</div>
                </div>
                {engine.current.mode === "MP" && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-neutral-800 px-3 py-1 rounded text-xs text-neutral-500">
                        P2P CONNECTED
                    </div>
                )}
                <div className="flex flex-col gap-1 items-end">
                    <div className="text-xl font-bold text-red-500">{engine.current.mode === "MP" ? (engine.current.mpRole === "CLIENT" ? "YOU (P2)" : "P2 (OPPONENT)") : "ENEMIES"}</div>
                    <div className="text-sm text-neutral-400">
                        {engine.current.mode === "MP" ? "Win the duel" : "Kill them all"}
                    </div>
                </div>
            </div>
        )}

        {/* MENU */}
        {gameState === "MENU" && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-8 backdrop-blur-sm">
                <div className="text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-blue-400 to-indigo-600">
                    RONIN
                </div>
                
                <div className="flex gap-4">
                     {[
                         { id: "SPEED", icon: RotateCcw, label: "Speed", speed: 1.3, power: 0.8 },
                         { id: "BALANCED", icon: User, label: "Balanced", speed: 1.0, power: 1.0 },
                         { id: "POWER", icon: Sword, label: "Power", speed: 0.8, power: 1.4 },
                     ].map((t) => (
                         <button 
                            key={t.id}
                            onClick={() => setPlayerStats({ speed: t.speed, power: t.power, type: t.id })}
                            className={`p-6 rounded-xl border-2 flex flex-col items-center gap-4 transition-all w-40 hover:scale-105
                                ${playerStats.type === t.id ? "border-blue-500 bg-blue-900/30 text-blue-100" : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:border-neutral-500"}`}
                         >
                            <t.icon size={32} />
                            <span className="font-bold">{t.label}</span>
                         </button>
                     ))}
                </div>

                <div className="flex gap-4">
                    <button 
                        onClick={startSinglePlayer}
                        className="flex items-center gap-2 px-8 py-4 bg-white text-black font-black text-xl rounded hover:bg-neutral-200 transition-colors"
                    >
                        <Play fill="black" /> SOLO (1v2)
                    </button>
                    <button 
                        onClick={() => setGameState("MP_MENU")}
                        className="flex items-center gap-2 px-8 py-4 bg-neutral-800 text-white font-black text-xl rounded hover:bg-neutral-700 transition-colors border border-neutral-700"
                    >
                        <Users /> MULTIPLAYER
                    </button>
                </div>
            </div>
        )}

        {/* MP MENU */}
        {gameState === "MP_MENU" && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-8 backdrop-blur-sm">
                <div className="text-4xl font-bold text-white">MULTIPLAYER (1v1)</div>
                <div className="flex gap-4">
                    <button onClick={hostGame} className="w-48 p-6 bg-blue-900/50 border border-blue-500 rounded hover:bg-blue-800/50 flex flex-col items-center gap-2">
                         <Wifi size={32} />
                         <span className="font-bold text-xl">HOST</span>
                         <span className="text-xs text-blue-300">Create a room code</span>
                    </button>
                    <div className="w-48 p-6 bg-neutral-900 border border-neutral-700 rounded flex flex-col items-center gap-4">
                         <input 
                            className="bg-black border border-neutral-600 p-2 text-center text-xl font-mono w-full rounded focus:outline-none focus:border-white"
                            placeholder="CODE"
                            maxLength={4}
                            value={inputRoomCode}
                            onChange={(e) => setInputRoomCode(e.target.value.replace(/\D/g,''))}
                         />
                         <button onClick={joinGame} className="w-full py-2 bg-white text-black font-bold rounded hover:bg-neutral-200">
                             JOIN
                         </button>
                    </div>
                </div>
                <button onClick={() => setGameState("MENU")} className="text-neutral-500 hover:text-white">Back</button>
            </div>
        )}

        {/* MP LOBBY */}
        {gameState === "MP_LOBBY" && (
             <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center gap-8">
                <div className="text-neutral-400">ROOM CODE</div>
                <div className="text-8xl font-mono font-black tracking-widest text-blue-400 border-4 border-blue-900/50 p-8 rounded bg-blue-950/20">
                    {roomCode}
                </div>
                <div className="animate-pulse text-white">{mpStatus}</div>
                <button onClick={() => setGameState("MP_MENU")} className="mt-8 text-neutral-500 hover:text-white">Cancel</button>
            </div>
        )}

        {/* RESULT */}
        {gameState === "GAME_OVER" && (
            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-6 z-50 animate-in fade-in duration-500">
                 {winner === "PLAYER" ? (
                     <div className="flex flex-col items-center gap-4 text-yellow-400">
                         <Trophy size={80} strokeWidth={1} />
                         <div className="text-6xl font-black">VICTORY</div>
                         <div className="text-neutral-400 text-lg">
                             {engine.current.mode === "MP" ? "You defeated your opponent." : "The 1v2 Showdown is yours."}
                         </div>
                     </div>
                 ) : (
                    <div className="flex flex-col items-center gap-4 text-red-600">
                        <Skull size={80} strokeWidth={1} />
                        <div className="text-6xl font-black">DEFEAT</div>
                        <div className="text-neutral-500 text-lg">
                             {engine.current.mode === "MP" ? "You were bested in combat." : "You fell to the numbers."}
                        </div>
                    </div>
                 )}

                 <button 
                    onClick={() => {
                        // Close connections if any
                        if (engine.current.peer) engine.current.peer.destroy();
                        setGameState("MENU");
                    }}
                    className="mt-8 px-8 py-3 border border-white/20 hover:bg-white/10 rounded text-white transition-all"
                 >
                    Return to Menu
                 </button>
            </div>
        )}
      </div>
    </div>
  );
}