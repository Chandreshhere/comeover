import React from 'react';
import { ScrollView, StatusBar, View } from 'react-native';
import { AppText, Card, Mascot } from '@/components';
import { colors, fonts, isDark, radius, space } from '@/theme/tokens';
import { useNavigationBar } from '@/services/systemBars';

// Shown when src/config.env.json has no backend values. There is no demo mode.
export default function NotConfigured() {
  useNavigationBar(colors.periwinkle);
  return (
    <View style={{ flex: 1, backgroundColor: colors.periwinkle }}>
      <StatusBar barStyle={isDark() ? 'light-content' : 'dark-content'} backgroundColor={colors.periwinkle} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg, paddingVertical: space.xxxl }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center' }}>
          <Mascot size={180} pose="wave" />
        </View>
        <AppText variant="h1" align="center" style={{ marginTop: space.lg }} accessibilityRole="header">
          Connect a backend
        </AppText>
        <AppText align="center" color={colors.inkSoft} style={{ marginTop: space.xs }}>
          Come Over talks only to the real API. Run the backend, then generate the app config:
        </AppText>
        <Card style={{ marginTop: space.lg, borderRadius: radius.quest }}>
          <AppText variant="label" selectable style={{ fontFamily: fonts.medium }}>
            npm run configure -- --api https://your-api-host/v1
          </AppText>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
            Writes API_URL and WS_URL into src/config.env.json. Rebuild the app afterwards.
          </AppText>
        </Card>
      </ScrollView>
    </View>
  );
}
