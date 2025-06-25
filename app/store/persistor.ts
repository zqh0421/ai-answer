import { persistStore } from 'redux-persist';
import { store } from '@/app/store/store';

export const persistor = persistStore(store);
