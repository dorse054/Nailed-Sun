import { screen } from './store';
import { MainMenu } from './screens/MainMenu';
import { BattleScreen } from './screens/BattleScreen';
import { CustomBattle } from './screens/CustomBattle';
import { Results } from './screens/Results';
import { Placeholder } from './screens/Placeholder';
import { Codex } from './screens/Codex';
import { CampaignRoot } from './campaign/CampaignStart';
import { LabRoute } from './screens/LabRoute';
import { TutorialsScreen } from './tutorial/TutorialsScreen';
import { Chronicles } from './screens/Chronicles';
import { Legends } from './screens/Legends';

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
      return <Results req={s.req} result={s.result} log={s.log} setup={s.setup} moments={s.moments} />;
    case 'codex':
      return <Codex page={s.page} />;
    case 'campaign':
      return <CampaignRoot />;
    case 'tutorials':
      return <TutorialsScreen />;
    case 'lab':
      return <LabRoute />;
    case 'chronicles':
      return <Chronicles />;
    case 'legends':
      return <Legends />;
    default:
      // Every screen has a case now; this only catches ones added later.
      return <Placeholder name={(s as { name: string }).name} />;
  }
}
