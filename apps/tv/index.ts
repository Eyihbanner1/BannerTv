// The TV app's entry: the shared data layer first (src/start.ts), then the root component.
import './src/start';
import { registerRootComponent } from 'expo';
import { App } from './src/App';

registerRootComponent(App);
