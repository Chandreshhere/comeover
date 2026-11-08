import React from 'react';
import { View } from 'react-native';
import { ErrorState } from '@/components';
import { colors } from '@/theme/tokens';

// App-level error boundary (P0 Foundation). Report to Sentry/CloudWatch here.
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.warn('[IRL] Unhandled UI error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.canvas }}>
        <ErrorState kind="api" title="This screen tripped up" body="Your data is safe. Try again, and if it keeps happening let us know from Settings." onRetry={() => this.setState({ error: null })} />
      </View>
    );
  }
}
