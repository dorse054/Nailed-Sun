import { useState } from 'preact/hooks';
import type { CampaignSession } from './session';
import { leaveCampaign } from './session';
import { factionDef } from '../../data/index';
import { factionLedger, ledgerNet, shudderIn } from '../../campaign/turn';
import { fmtNum } from '../../campaign/state';
import { go } from '../store';
import { OWNER_COLOR } from './campaignMap';

function signed(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${fmtNum(r)}` : r < 0 ? `−${fmtNum(-r)}` : '±0';
}

export function TopBar({ session }: { session: CampaignSession }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const f = session.player;
  const fs = s.factions[f];
  const fd = factionDef(f);
  const net = ledgerNet(factionLedger(s, f));
  const [menu, setMenu] = useState(false);
  const shudder = shudderIn(s);
  return (
    <header class="camp-top panel">
      <div class="camp-fac" style={{ '--fc': OWNER_COLOR[f] } as never}>
        <span class="camp-dot" aria-hidden="true" />
        <div>
          <b>{fd.short}</b>
          <small>Toll {s.turn}</small>
        </div>
      </div>
      <div class="camp-res" role="group" aria-label="Treasury">
        <Res label="Coin" value={fs.coin} delta={net.coin} warn={fs.coin < 0} />
        <Res label="Food" value={fs.food} delta={net.food} warn={fs.food < 0} />
        <Res label={fd.resource.name} value={fs.res} delta={net.res} title={fd.resource.desc} />
        {f === 'choir' && <Res label="Zeal" value={fs.zeal} />}
      </div>
      <Tilt tilt={s.tilt} progress={s.tiltProgress} shudder={shudder} active={s.shudder.active} />
      <nav class="camp-nav">
        <button class="btn" onClick={() => (session.panel.value = session.panel.value === 'faction' ? 'none' : 'faction')}>
          Faction
        </button>
        <button class="btn" onClick={() => (session.panel.value = session.panel.value === 'diplomacy' ? 'none' : 'diplomacy')}>
          Diplomacy
        </button>
        <button class="btn" onClick={() => (session.panel.value = session.panel.value === 'log' ? 'none' : 'log')}>
          Chronicle
        </button>
        <div class="camp-menu-wrap">
          <button class="btn ghost" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            Menu
          </button>
          {menu && (
            <div class="camp-menu panel" role="menu">
              <button
                class="btn"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  session.say(session.save() ? 'Campaign saved.' : 'Could not save in this browser.');
                }}
              >
                Save
              </button>
              <button
                class="btn"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  session.panel.value = 'help';
                }}
              >
                How to play
              </button>
              <button
                class="btn"
                role="menuitem"
                onClick={() => {
                  leaveCampaign();
                  go({ name: 'menu' });
                }}
              >
                Save and quit
              </button>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}

function Res({ label, value, delta, warn, title }: { label: string; value: number; delta?: number; warn?: boolean; title?: string }) {
  return (
    <div class={`camp-r ${warn ? 'warn' : ''}`} title={title}>
      <span class="label">{label}</span>
      <b class="num">{fmtNum(value)}</b>
      {delta !== undefined && <small class={`num ${delta < 0 ? 'neg' : 'pos'}`}>{signed(delta)}</small>}
    </div>
  );
}

function Tilt({ tilt, progress, shudder, active }: { tilt: number; progress: number; shudder: number; active: boolean }) {
  const pos = ((tilt + 5) / 10) * 100;
  const next = Math.max(-100, Math.min(100, progress));
  return (
    <div class="camp-tilt" title={`The Tilt: ${tilt > 0 ? '+' : ''}${tilt}. Pressure toward the next step: ${Math.round(next)}. ${active ? 'The Great Shudder shakes the world.' : shudder > 0 ? `The Great Shudder begins in ${shudder} Tolls unless someone wins.` : ''}`}>
      <div class="spread">
        <span class="label">Nightward</span>
        <b>
          Tilt {tilt > 0 ? '+' : ''}
          {tilt}
        </b>
        <span class="label">Sunward</span>
      </div>
      <div class="tilt-bar" aria-hidden="true">
        {Array.from({ length: 11 }, (_, i) => (
          <i key={i} class={i === 5 ? 'mid' : ''} style={{ left: `${i * 10}%` }} />
        ))}
        <div class="tilt-press" style={{ left: `${pos}%`, width: `${Math.abs(next) / 10}%`, transform: next < 0 ? 'translateX(-100%)' : undefined, background: next < 0 ? '#6f7cff' : '#ffc45a' }} />
        <div class="tilt-mark" style={{ left: `${pos}%` }} />
      </div>
      {active && <small class="shudder">The Great Shudder</small>}
    </div>
  );
}
