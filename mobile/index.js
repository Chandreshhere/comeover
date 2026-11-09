import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './src/App';

// Release builds have no red box: make every uncaught JS error show up in the
// device log (Console.app / Xcode) before the default handler runs.
const prevHandler = global.ErrorUtils?.getGlobalHandler?.();
global.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
  try {
    console.error(`[ComeOver] ${isFatal ? 'FATAL' : 'error'}: ${error?.message}\n${error?.stack || ''}`);
  } catch (e) {
    // ignore
  }
  prevHandler?.(error, isFatal);
});
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
