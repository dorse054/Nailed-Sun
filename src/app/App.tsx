import { screen } from './store';
import { MainMenu } from './screens/MainMenu';
import { BattleScreen } from './screens/BattleScreen';
import { CustomBattle } from './screens/CustomBattle';
import { Results } from './screens/Results';
import { Placeholder } from './screens/Placeholder';
import { Codex } from './screens/Codex';

export function App() {
  const s = screen.value;
  switch (s.name) {
    case 'menu':
      return <MainMenu />;
    case 'custom':
      return <CustomBattle />;
    case 'battle':
      return <BattleScreen key={JSON.stringify(s.req.setup.seed) + s.req.mode} req={s.req} />;
    case 'results':
      return <Results req={s.req} result={s.result} log={s.log} setup={s.setup} />;
    case 'codex':
      return <Codex page={s.page} />;
    case 'lab':
      return <Placeholder name="Balance Lab" />;
    default:
      return <Placeholder name={s.name} />;
  }
}
