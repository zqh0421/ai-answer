import { persistStore } from 'redux-persist';
import { store } from '@/app/store/store';

// 创建持久化存储实例
export const persistor = persistStore(store);
