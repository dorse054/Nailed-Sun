import { screen } from './store';
import { MainMenu } from './screens/MainMenu';
import { BattleScreen } from './screens/BattleScreen';
import { Placeholder } from './screens/Placeholder';
import { Codex } from './screens/Codex';

export function App() {
  const s = screen.value;
  switch (s.name) {
    case 'menu':
      return <MainMenu />;
    case 'battle':
      return <BattleScreen key={JSON.stringify(s.req.setup.seed) + s.req.mode} req={s.req} />;
    case 'codex':
      return <Codex page={s.page} />;
    default:
      return <Placeholder name={s.name} />;
  }
}
