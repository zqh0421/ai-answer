'use client'; // 必须是客户端组件

import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store } from '../store/store';
import { persistor } from '../store/persistor';
import { SessionProvider } from 'next-auth/react';

export default function ClientProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <PersistGate loading={<div>Loading...</div>} persistor={persistor}>
        <SessionProvider>{children}</SessionProvider>
      </PersistGate>
    </Provider>
  );
}
