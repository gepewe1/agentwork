/* AgentWork — demo core + browser UI.
 * The Core functions below mirror AgentWorkBoard.sol rule-for-rule so the
 * offline demo behaves like the contract: Agent ID gating, escrow, fair
 * refund / timeout paths, and Passport updates. They are pure functions on a
 * state object so test/smoke.test.js can exercise them in Node.
 */
(function () {
  "use strict";

  // ---------------- Core (mirrors the contract) ----------------
  const Core = {
    isHolder(state, personaId) {
      const p = state.personas.find((x) => x.id === personaId);
      return !!(p && p.holder);
    },
    persona(state, id) { return state.personas.find((x) => x.id === id); },

    registerInteractor(state, personaId) {
      const p = Core.persona(state, personaId);
      const key = p ? p.address : personaId;
      if (!state.interactors.includes(key)) state.interactors.push(key);
    },

    createBounty(state, personaId, data, now) {
      if (!Core.isHolder(state, personaId)) throw new Error("AgentWork: Agent ID required");
      if (!(data.reward > 0)) throw new Error("AgentWork: reward required");
      if (!data.title) throw new Error("AgentWork: title required");
      const deadline = now + data.hours * 3600 * 1000;
      const b = {
        id: state.nextId++, posterId: personaId, workerId: null,
        title: data.title, descriptionURI: data.descriptionURI || "",
        skillTag: (data.skillTag || "general").toLowerCase(),
        reward: data.reward, deadline, approvalWindowH: data.approvalHours || 72,
        submittedAt: null, deliverableURI: "", rating: 0, status: "Open"
      };
      state.bounties.push(b);
      Core.registerInteractor(state, personaId);
      return b;
    },

    claimBounty(state, id, personaId, now) {
      if (!Core.isHolder(state, personaId)) throw new Error("AgentWork: Agent ID required");
      const b = state.bounties.find((x) => x.id === id);
      if (!b) throw new Error("AgentWork: no such bounty");
      if (b.status !== "Open") throw new Error("AgentWork: not open");
      if (b.posterId === personaId) throw new Error("AgentWork: cannot claim own bounty");
      if (now > b.deadline) throw new Error("AgentWork: deadline passed");
      b.workerId = personaId; b.status = "Claimed";
      Core.registerInteractor(state, personaId);
      return b;
    },

    submitWork(state, id, personaId, uri, now) {
      if (!Core.isHolder(state, personaId)) throw new Error("AgentWork: Agent ID required");
      const b = state.bounties.find((x) => x.id === id);
      if (!b || b.status !== "Claimed") throw new Error("AgentWork: not claimed");
      if (b.workerId !== personaId) throw new Error("AgentWork: not the worker");
      if (!uri) throw new Error("AgentWork: deliverable required");
      const onTime = now <= b.deadline;
      b.deliverableURI = uri; b.submittedAt = now; b.status = "Submitted";
      const p = Core.passport(state, Core.persona(state, personaId).address);
      p.jobsSubmitted += 1; if (onTime) p.onTimeCount += 1;
      return b;
    },

    approveAndRate(state, id, personaId, rating) {
      const b = state.bounties.find((x) => x.id === id);
      if (!b || b.status !== "Submitted") throw new Error("AgentWork: not submitted");
      if (b.posterId !== personaId) throw new Error("AgentWork: not the poster");
      if (!(rating >= 1 && rating <= 5)) throw new Error("AgentWork: rating 1-5");
      b.rating = rating; b.status = "Completed";
      const p = Core.passport(state, Core.persona(state, b.workerId).address);
      p.jobsCompleted += 1; p.totalEarned += b.reward;
      p.ratingSum += rating; p.ratingCount += 1;
      return b;
    },

    claimTimeoutPayment(state, id, personaId, now) {
      const b = state.bounties.find((x) => x.id === id);
      if (!b || b.status !== "Submitted") throw new Error("AgentWork: not submitted");
      if (b.workerId !== personaId) throw new Error("AgentWork: not the worker");
      if (!(now > b.submittedAt + b.approvalWindowH * 3600 * 1000))
        throw new Error("AgentWork: approval window open");
      b.status = "Completed";
      const p = Core.passport(state, Core.persona(state, b.workerId).address);
      p.jobsCompleted += 1; p.totalEarned += b.reward;
      return b;
    },

    refundExpired(state, id, now) {
      const b = state.bounties.find((x) => x.id === id);
      if (!b) throw new Error("AgentWork: no such bounty");
      if (!(now > b.deadline)) throw new Error("AgentWork: not expired");
      if (b.status !== "Open" && b.status !== "Claimed")
        throw new Error("AgentWork: not refundable");
      b.status = "Refunded";
      return b;
    },

    // Passport is keyed by HOLDER ADDRESS — exactly like the contract's
    // passportByAddress. (The real Agent ID contract exposes no token-id
    // lookup at all; only balanceOf. See contracts/IAgentID.sol.)
    passport(state, address) {
      if (!state.passports[address])
        state.passports[address] = { jobsCompleted: 0, jobsSubmitted: 0, totalEarned: 0, ratingSum: 0, ratingCount: 0, onTimeCount: 0 };
      return state.passports[address];
    },
    avgRating(p) { return p.ratingCount ? p.ratingSum / p.ratingCount : 0; },
    onTimeRate(p) { return p.jobsSubmitted ? (p.onTimeCount / p.jobsSubmitted) * 100 : 0; }
  };

  function seedState() {
    const now = Date.now(), H = 3600 * 1000;
    const personas = [
      { id: "you", name: "you.ai", address: "0xA11CE00000000000000000000000000000YOU1", holder: true },
      { id: "nova", name: "nova.ai", address: "0xN0VA0000000000000000000000000000000NVA2", holder: true },
      { id: "kilo", name: "kilo.ai", address: "0xK1100000000000000000000000000000000KLO3", holder: true },
      { id: "mira", name: "mira.ai", address: "0xM12A0000000000000000000000000000000MRA4", holder: true },
      { id: "guest", name: "no-id (visitor)", address: "0xGUE5700000000000000000000000000000GST5", holder: false }
    ];
    const s = {
      personas, currentPersonaId: "you", nextId: 7, bounties: [], passports: {},
      interactors: personas.filter(p => p.holder).map(p => p.address)
        .concat(Array.from({ length: 10 }, (_, i) => "0xSEED" + (1000 + i)))
    };
    s.bounties = [
      { id: 1, posterId: "nova", workerId: null, title: "Summarise 40 pages of BNB Chain governance proposals", descriptionURI: "ipfs://demo/governance-brief", skillTag: "research", reward: 0.08, deadline: now + 30 * H, approvalWindowH: 72, submittedAt: null, deliverableURI: "", rating: 0, status: "Open" },
      { id: 2, posterId: "you", workerId: null, title: "Design a one-page explainer: what is an Agent ID?", descriptionURI: "ipfs://demo/explainer-brief", skillTag: "design", reward: 0.05, deadline: now + 52 * H, approvalWindowH: 72, submittedAt: null, deliverableURI: "", rating: 0, status: "Open" },
      { id: 3, posterId: "kilo", workerId: "nova", title: "Audit a 200-line escrow contract for reentrancy", descriptionURI: "ipfs://demo/audit-brief", skillTag: "solidity", reward: 0.12, deadline: now + 20 * H, approvalWindowH: 72, submittedAt: null, deliverableURI: "", rating: 0, status: "Claimed" },
      { id: 4, posterId: "you", workerId: "mira", title: "Clean and label 500 rows of wallet-interaction data", descriptionURI: "ipfs://demo/data-brief", skillTag: "data", reward: 0.04, deadline: now - 2 * H, approvalWindowH: 72, submittedAt: now - 5 * H, deliverableURI: "ipfs://demo/delivery-500-rows", rating: 0, status: "Submitted" },
      { id: 5, posterId: "mira", workerId: "kilo", title: "Translate a product README EN → Bahasa Indonesia", descriptionURI: "ipfs://demo/translate-brief", skillTag: "writing", reward: 0.03, deadline: now - 26 * H, approvalWindowH: 72, submittedAt: now - 30 * H, deliverableURI: "ipfs://demo/delivery-readme-id", rating: 5, status: "Completed" },
      { id: 6, posterId: "nova", workerId: null, title: "Expired demo bounty (refund path)", descriptionURI: "ipfs://demo/expired-brief", skillTag: "research", reward: 0.02, deadline: now - 1 * H, approvalWindowH: 72, submittedAt: null, deliverableURI: "", rating: 0, status: "Open" }
    ];
    // Seed passports consistent with bounty 5 (+ a little history)
    s.passports["0xK1100000000000000000000000000000000KLO3"] = { jobsCompleted: 4, jobsSubmitted: 4, totalEarned: 0.21, ratingSum: 19, ratingCount: 4, onTimeCount: 4 }; // kilo.ai
    s.passports["0xN0VA0000000000000000000000000000000NVA2"] = { jobsCompleted: 2, jobsSubmitted: 3, totalEarned: 0.11, ratingSum: 9, ratingCount: 2, onTimeCount: 2 }; // nova.ai
    s.passports["0xM12A0000000000000000000000000000000MRA4"] = { jobsCompleted: 1, jobsSubmitted: 2, totalEarned: 0.03, ratingSum: 5, ratingCount: 1, onTimeCount: 1 }; // mira.ai
    s.passports["0xA11CE00000000000000000000000000000YOU1"] = { jobsCompleted: 0, jobsSubmitted: 0, totalEarned: 0, ratingSum: 0, ratingCount: 0, onTimeCount: 0 }; // you.ai
    return s;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Core, seedState };
    return; // Node (tests): no DOM work
  }

  // ---------------- Browser UI ----------------
  const CFG = window.AGENTWORK_CONFIG || { mode: "demo", targetInteractors: 30 };
  const KEY = "agentwork-demo-v2"; // v2: passports keyed by holder address (was token id in v1)
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || seedState(); }
  catch (e) { state = seedState(); }
  if (!state.personas) state = seedState();
  let selectedId = null, pendingRating = 5;

  const $ = (id) => document.getElementById(id);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
  const me = () => Core.persona(state, state.currentPersonaId);
  const nameOf = (pid) => { const p = Core.persona(state, pid); return p ? p.name : "—"; };
  function toast(msg, isErr) {
    const t = $("toast"); t.textContent = msg; t.className = "toast" + (isErr ? " error" : "");
    t.hidden = false; setTimeout(() => { t.hidden = true; }, 4200);
  }
  function act(fn, okMsg) {
    try { fn(); save(); render(); if (okMsg) toast(okMsg); }
    catch (e) { toast(e.message, true); }
  }

  function passportHTML(p, address) {
    const pp = Core.passport(state, address);
    return `<div class="passport-stats">
      <div class="stat"><span class="muted small">Holder address</span><b class="small">${address}</b></div>
      <div class="stat"><span class="muted small">Jobs completed</span><b>${pp.jobsCompleted}</b></div>
      <div class="stat"><span class="muted small">Total earned</span><b>${pp.totalEarned.toFixed(3)} BNB</b></div>
      <div class="stat"><span class="muted small">Avg rating</span><b>${pp.ratingCount ? Core.avgRating(pp).toFixed(2) + " / 5" : "—"}</b></div>
      <div class="stat"><span class="muted small">On-time rate</span><b>${pp.jobsSubmitted ? Core.onTimeRate(pp).toFixed(0) + "%" : "—"}</b></div>
      <div class="stat"><span class="muted small">Jobs submitted</span><b>${pp.jobsSubmitted}</b></div></div>
      <p class="muted small">This passport is stored under the holder address itself. The Agent ID at that address is non-transferable and one-per-person — so this record cannot be sold or moved either.</p>`;
  }

  function render() {
    // banner + persona
    $("modeBanner").textContent = CFG.mode === "wallet"
      ? "WALLET MODE (config) — demo data still shown until a deployed board address is configured. See SUBMISSION.md."
      : "DEMO MODE — fully offline simulation of the contract rules. No wallet, no funds, no network. Switch identity (top right) — try the non-holder to see the Agent ID gate close.";
    $("modeBanner").className = "banner" + (CFG.mode === "wallet" ? " wallet" : "");
    const sel = $("personaSelect");
    sel.innerHTML = state.personas.map(p =>
      `<option value="${p.id}" ${p.id === state.currentPersonaId ? "selected" : ""}>${p.name}${p.holder ? "" : " — no Agent ID"}</option>`).join("");

    // tracker
    const n = state.interactors.length, target = CFG.targetInteractors || 30;
    $("interactorCount").textContent = n;
    $("interactorBar").style.width = Math.min(100, (n / target) * 100) + "%";
    $("interactorNote").textContent = n >= target
      ? "Target reached — Innovation Award interaction threshold met (in demo data)."
      : `${target - n} more genuine Agent ID holders needed for Innovation Award eligibility. Real interactions only — fakes get projects disqualified.`;

    // hero + full passport
    const m = me();
    $("heroPassport").innerHTML = m.holder
      ? `<strong>${m.name}</strong> · ${m.address}<br><span class="muted">${Core.passport(state, m.address).jobsCompleted} jobs · ${Core.avgRating(Core.passport(state, m.address)).toFixed(2) || "—"} avg rating</span>`
      : `<strong>${m.name}</strong><br><span class="muted">No Agent ID — posting, claiming and submitting are locked, exactly as the contract enforces.</span>`;
    $("passportFull").innerHTML = m.holder ? passportHTML(m, m.address)
      : `<p>🚪 <strong>The gate is closed for this identity.</strong> Without an Agent ID, the contract's
         <code>onlyAgentIdHolder</code> check rejects create / claim / submit. Claim an Agent ID in the
         Binance app (Wallet → Agent ID banner) to participate.</p>`;

    // filters
    const skills = [...new Set(state.bounties.map(b => b.skillTag))];
    const fs = $("filterSkill"), cur = fs.value;
    fs.innerHTML = `<option value="">All skills</option>` + skills.map(s => `<option ${s === cur ? "selected" : ""}>${s}</option>`).join("");
    const fSkill = fs.value, fStatus = $("filterStatus").value;

    // grid
    $("bountyGrid").innerHTML = state.bounties
      .filter(b => (!fSkill || b.skillTag === fSkill) && (!fStatus || b.status === fStatus))
      .map(b => `<article class="card" data-id="${b.id}">
          <span class="chip">${b.skillTag}</span> <span class="chip status-${b.status}">${b.status}</span>
          <h3>${b.title}</h3>
          <div class="reward">${b.reward} BNB</div>
          <p class="muted small">Poster ${nameOf(b.posterId)}${b.workerId ? " · Worker " + nameOf(b.workerId) : ""}<br>
          Deadline ${new Date(b.deadline).toLocaleString()}</p></article>`).join("")
      || `<p class="muted">No bounties match these filters.</p>`;
    document.querySelectorAll(".card").forEach(c =>
      c.addEventListener("click", () => { selectedId = +c.dataset.id; renderDetail(); }));

    renderDetail();
  }

  function renderDetail() {
    const panel = $("detailPanel");
    const b = state.bounties.find(x => x.id === selectedId);
    if (!b) { panel.innerHTML = ""; return; }
    const m = me(), now = Date.now();
    let actions = "";
    if (b.status === "Open" && now <= b.deadline && b.posterId !== m.id)
      actions += `<button class="btn primary small" id="dClaim">Claim this bounty</button>`;
    if (b.status === "Open" && now > b.deadline)
      actions += `<button class="btn small" id="dRefund">Refund expired → poster</button>`;
    if (b.status === "Claimed" && b.workerId === m.id)
      actions += `<input id="dUri" placeholder="Deliverable URI / hash" style="min-width:260px">
                  <button class="btn primary small" id="dSubmit">Submit work</button>`;
    if (b.status === "Claimed" && now > b.deadline)
      actions += `<button class="btn small" id="dRefund">Refund (deadline missed) → poster</button>`;
    if (b.status === "Submitted" && b.posterId === m.id)
      actions += `<span class="stars" id="dStars">${"★".repeat(pendingRating)}${"☆".repeat(5 - pendingRating)}</span>
                  <button class="btn small" id="dRateMinus">−</button><button class="btn small" id="dRatePlus">+</button>
                  <button class="btn primary small" id="dApprove">Approve &amp; pay ${b.reward} BNB</button>`;
    if (b.status === "Submitted" && b.workerId === m.id)
      actions += `<button class="btn small" id="dTimeout">Claim timeout payment (after approval window)</button>
                  <span class="muted small">Demo tip: in the contract this unlocks ${b.approvalWindowH}h after submission.</span>`;
    panel.innerHTML = `<div class="panel detail"><h3>${b.title}</h3>
      <p class="muted">Status <strong>${b.status}</strong> · Skill ${b.skillTag} · Reward <strong>${b.reward} BNB (escrowed)</strong><br>
      Poster ${nameOf(b.posterId)}${b.workerId ? " · Worker " + nameOf(b.workerId) : ""} · Deadline ${new Date(b.deadline).toLocaleString()}
      ${b.descriptionURI ? `<br>Brief: ${b.descriptionURI}` : ""}${b.deliverableURI ? `<br>Deliverable: ${b.deliverableURI}` : ""}
      ${b.rating ? `<br>Rating: <span class="stars">${"★".repeat(b.rating)}</span>` : ""}</p>
      <div class="actions">${actions || '<span class="muted small">No action available for your identity on this bounty.</span>'}</div></div>`;

    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
    on("dClaim", () => act(() => Core.claimBounty(state, b.id, m.id, Date.now()), "Claimed! The contract verified your Agent ID on-chain (simulated)."));
    on("dRefund", () => act(() => Core.refundExpired(state, b.id, Date.now()), "Escrow refunded to the poster."));
    on("dSubmit", () => act(() => Core.submitWork(state, b.id, m.id, $("dUri").value.trim(), Date.now()), "Work submitted. Poster has the approval window to respond."));
    on("dApprove", () => act(() => Core.approveAndRate(state, b.id, m.id, pendingRating), "Approved — escrow paid to the worker and their Passport updated."));
    on("dTimeout", () => act(() => Core.claimTimeoutPayment(state, b.id, m.id, Date.now()), "Timeout payment claimed."));
    on("dRateMinus", () => { pendingRating = Math.max(1, pendingRating - 1); renderDetail(); });
    on("dRatePlus", () => { pendingRating = Math.min(5, pendingRating + 1); renderDetail(); });
  }

  // ---------------- Wiring ----------------
  $("personaSelect").addEventListener("change", (e) => { state.currentPersonaId = e.target.value; save(); render(); });
  $("filterSkill").addEventListener("change", render);
  $("filterStatus").addEventListener("change", render);
  $("createForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    act(() => Core.createBounty(state, me().id, {
      title: f.get("title"), skillTag: f.get("skillTag"), descriptionURI: f.get("descriptionURI"),
      reward: parseFloat(f.get("reward")), hours: parseFloat(f.get("hours")),
      approvalHours: parseFloat(f.get("approvalHours"))
    }, Date.now()), "Bounty posted and reward escrowed (simulated).");
  });
  $("resetDemo").addEventListener("click", () => { state = seedState(); save(); selectedId = null; render(); toast("Demo data reset."); });

  $("connectBtn").addEventListener("click", async () => {
    if (CFG.mode !== "wallet") { toast("Demo mode: no wallet needed. Set mode:'wallet' + boardAddress in config.js after deployment."); return; }
    try {
      if (typeof window.ethers === "undefined") throw new Error("ethers failed to load (CDN offline) — demo mode still works.");
      if (!window.ethereum) throw new Error("No injected wallet found.");
      if (!CFG.boardAddress) throw new Error("boardAddress is empty in config.js — deploy first (see SUBMISSION.md).");
      const provider = new window.ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const id = new window.ethers.Contract(CFG.agentIdAddress, ["function balanceOf(address) view returns (uint256)"], provider);
      const bal = await id.balanceOf(await signer.getAddress());
      toast(bal > 0n ? "Connected — Agent ID detected for this wallet." : "Connected — but this wallet holds no Agent ID, so the contract will reject create/claim/submit.");
    } catch (e) { toast(e.message, true); }
  });

  render();
})();
