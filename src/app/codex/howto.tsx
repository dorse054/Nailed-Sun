/**
 * Codex: how to play. Getting started, the controls (mouse, keyboard and
 * touch), how a battle unfolds, and the campaign in brief.
 */
import { FACTION_IDS } from '../../data/schema';
import { FACTIONS } from '../../data/index';
import { ARMY } from '../../data/rules';
import { FactionLink, Items, type Nav, PageHead, Section, Toc } from './ui';

export function HowToPage({ nav }: { nav: Nav }) {
  return (
    <>
      <PageHead title="How to Play">
        <p class="cx-lede">Nailed Sun is a turn-based campaign across a world that stopped turning, with real-time battles you fight yourself. The sun never moves, so where it stands, and where the wind blows, decide how you deploy.</p>
        <Toc
          items={[
            { id: 'cx-h-start', label: 'Start here' },
            { id: 'cx-h-mouse', label: 'Mouse and keys' },
            { id: 'cx-h-touch', label: 'Touch' },
            { id: 'cx-h-battle', label: 'A battle' },
            { id: 'cx-h-campaign', label: 'The campaign' },
            { id: 'cx-h-files', label: 'Saves and replays' },
          ]}
        />
      </PageHead>
      <Section id="cx-h-start" title="Start here">
        <Items
          items={[
            { name: 'Tutorials', desc: 'Four short battles, one per faction, each teaching its core idea. About five minutes each. The best first step.' },
            { name: 'Quick Battle', desc: 'A random fight between two random armies, right now.' },
            { name: 'Custom Battle', desc: 'Pick both armies, the light band, the wind, where the sun stands and the ground. Fight in the open, assault a walled town or hold one.' },
            { name: 'Campaign', desc: 'Lead one faction across thirty-one regions for a hundred Tolls or so, toward its own victory.' },
            { name: 'Watch a Battle', desc: 'Two scripted generals fight while you watch.' },
          ]}
        />
      </Section>
      <Section id="cx-h-mouse" title="Mouse and keys">
        <Items
          items={[
            { name: 'Select', desc: 'Left-click a unit or its card. Drag a box to select many; Shift adds to the selection. Double-click selects every unit of that type.' },
            { name: 'Move and attack', desc: 'Right-click the ground to move, or an enemy to attack.' },
            { name: 'Form a line', desc: 'Right-drag: the selection lines up along the drag, facing away from you. Hold Alt as you order to walk rather than run.' },
            { name: 'Camera', desc: 'Wheel zooms. WASD or the arrow keys pan.' },
            { name: 'Keys', desc: 'Space pauses (you can still give orders), R run or walk, F fire at will, H halt, M melee mode, 1 to 3 abilities, + and − change speed.' },
          ]}
        />
      </Section>
      <Section id="cx-h-touch" title="Touch">
        <Items
          items={[
            { name: 'Select and order', desc: 'Tap a unit to select it, then tap the ground to move or an enemy to attack. Drag to pan and pinch to zoom.' },
            { name: 'What a finger does', desc: 'The bar above the unit cards: Pan (the default), Select (taps add or remove units, a drag draws a selection box) or Line (a drag lays the selection out along a line). All selects every unit.' },
            { name: 'More field', desc: 'The ▾ button folds the unit panel, and the Toll folds to a single line until you tap it. Tap a unit’s chips to read their exact numbers.' },
          ]}
        />
      </Section>
      <Section id="cx-h-battle" title="A battle, step by step">
        <Items
          items={[
            { name: 'Read the Rose', desc: 'The Sun-and-Wind Rose shows where the sun stands and which way the wind blows (always sunward). Facing the sun in the Gloaming or Long Afternoon means glare: worse aim and, at dusk, worse blows. Shots downwind fly farther; upwind, shorter.' },
            { name: 'Deploy', desc: 'Drag your units inside the blue zone. Put the sun at your back if you can, and your archers upwind. Shadows never move: units standing in them stay hidden until an enemy comes close.' },
            { name: 'Fight', desc: 'Every soldier is simulated. Charges hit hardest into flanks and rears, spears brace against horses, and fatigue wears units down. Big abilities show a marker on the ground before they land.' },
            { name: 'Morale', desc: 'Units waver, rout and can rally. Most units run before they die, so a lost fight rarely means a lost army. Losing your general shakes everyone.' },
            { name: 'Win', desc: 'Rout the enemy army. In a fortified battle, the attacker wins by holding the town square for a minute; the defender by holding out until time runs out. When what is left of the enemy can no longer win, the Menu lets you claim the field rather than chase it down.' },
          ]}
        />
      </Section>
      <Section id="cx-h-campaign" title="The campaign">
        <Items
          items={[
            { name: 'Tolls', desc: 'Each turn is a Toll. Move your armies, recruit, build, then End Toll: the other factions move, battles are fought, and the economy turns.' },
            { name: 'Armies', desc: `Select an army and click a region to march. An army holds up to ${ARMY.maxUnits} units plus its lord. Each extra copy of the same unit costs more upkeep, so mixed armies are cheaper.` },
            { name: 'Heroes', desc: 'Heroes fight in armies, or the ✦ button sends one out alone: up to two regions a Toll past any army, and once a Toll it can rally a friendly town, sabotage an enemy one or scout. It rejoins any friendly army it meets.' },
            { name: 'Settlements', desc: 'Build chains in each settlement’s plots. Buildings unlock units, raise coin and food, and keep public order up; low order means revolts.' },
            { name: 'Battles', desc: 'When armies meet, fight the battle yourself or auto-resolve it with the same simulation. The direction you attack from decides where the sun stands.' },
            { name: 'The Tilt', desc: 'Faction actions push the world sunward or nightward, shifting every region’s light and harvest. After Toll 70 the Great Shudder shakes it at random.' },
            { name: 'Diplomacy', desc: 'Trade, alliances, peace and gifts. Every offer is valued before it is sent, from insult to generous. The other factions make offers and demands of their own.' },
            { name: 'Claude as counsel', desc: 'Played on claude.ai, Settings can let the AI factions take Claude’s advice: every other Toll each asks Claude, in character, whether to change its wars, treaties or plans, and envoys decide your closer proposals and answer in their own words. In battles, the enemy general reads the field while you deploy, chooses to attack, hold or lie in ambush, and speaks. Choices made on its advice are marked ✦ Claude in the chronicle.' },
          ]}
        />
        <p class="cx-note">
          Each faction wins its own way:{' '}
          {FACTION_IDS.map((id, i) => (
            <span key={id}>
              {i > 0 && (i === FACTION_IDS.length - 1 ? ' and ' : ', ')}
              <FactionLink f={FACTIONS[id]} nav={nav} /> by {FACTIONS[id].victory.name}
            </span>
          ))}
          . Final victory stages open on Toll 50.
        </p>
      </Section>
      <Section id="cx-h-files" title="Saves and replays">
        <Items
          items={[
            { name: 'Campaign saves', desc: 'Your campaign saves itself after every Toll. Settings can download it as a file, to keep a copy or carry it to another device, and load it back.' },
            { name: 'Replays', desc: 'Every battle replays exactly from its orders. After a battle, Watch the replay, or Save replay as a small file; open one again from Custom Battle.' },
          ]}
        />
      </Section>
    </>
  );
}
