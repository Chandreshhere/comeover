// Feature module: onboarding (launch + account setup).
import BootSplashScreen from './BootSplashScreen';
import ServiceStatusScreen from './ServiceStatusScreen';
import WelcomeScreen from './WelcomeScreen';
import PhoneEntryScreen from './PhoneEntryScreen';
import OtpVerifyScreen from './OtpVerifyScreen';
import AgeGateScreen from './AgeGateScreen';
import ProfileSetupScreen from './ProfileSetupScreen';
import InterestPickerScreen from './InterestPickerScreen';
import IntentPickerScreen from './IntentPickerScreen';
import LocationExplainerScreen from './LocationExplainerScreen';
import LocationPermissionScreen from './LocationPermissionScreen';
import NotificationOptInScreen from './NotificationOptInScreen';
import SafetyIntroScreen from './SafetyIntroScreen';
import FirstPlanPromptScreen from './FirstPlanPromptScreen';

export const screens = {
  boot_splash: BootSplashScreen,
  service_status: ServiceStatusScreen,
  welcome: WelcomeScreen,
  phone_entry: PhoneEntryScreen,
  otp_verify: OtpVerifyScreen,
  age_gate: AgeGateScreen,
  profile_setup: ProfileSetupScreen,
  interest_picker: InterestPickerScreen,
  intent_picker: IntentPickerScreen,
  location_explainer: LocationExplainerScreen,
  location_permission: LocationPermissionScreen,
  notification_opt_in: NotificationOptInScreen,
  safety_intro: SafetyIntroScreen,
  first_plan_prompt: FirstPlanPromptScreen,
};

// Splash and welcome shouldn't be swiped back into once left.
export const options = {
  boot_splash: { animation: 'fade', gestureEnabled: false },
  welcome: { animation: 'fade', gestureEnabled: false },
  service_status: { gestureEnabled: false },
  first_plan_prompt: { gestureEnabled: false },
};
