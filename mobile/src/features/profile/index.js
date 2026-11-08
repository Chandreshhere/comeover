// Feature module: profile (own & public profile, edit, privacy, settings).
import ProfileHomeScreen from './ProfileHomeScreen';
import ProfileEditScreen from './ProfileEditScreen';
import PrivacyControlsScreen from './PrivacyControlsScreen';
import AccountSettingsScreen from './AccountSettingsScreen';

export const screens = {
  profile_home: ProfileHomeScreen,
  profile_edit: ProfileEditScreen,
  privacy_controls: PrivacyControlsScreen,
  account_settings: AccountSettingsScreen,
};
