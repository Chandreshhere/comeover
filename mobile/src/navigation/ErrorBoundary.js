import React from 'react';
import { ScrollView, View } from 'react-native';
import { EmptyState } from '@/components';
import { colors, space } from '@/theme/tokens';

// App-level error boundary (P0 Foundation). Report to Sentry/CloudWatch here.
// Friendly, never a dead end: Mo waves and "Try again" remounts the subtree.
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.warn('[ComeOver] Unhandled UI error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg }}>
          <EmptyState
            title="This screen tripped up"
            body="Your data is safe. Try again, and if it keeps happening let us know from Settings."
            cta="Try again"
            onCta={() => this.setState({ error: null })}
            pose="wave"
          />
        </ScrollView>
      </View>
    );
  }
}
