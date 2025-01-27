import { configureStore } from '@reduxjs/toolkit';
import { persistReducer } from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import { combineReducers } from 'redux';
import userReducer from '@/app/slices/userSlice'; // 确保引入 userReducer
import counterReducer from '@/app/slices/couterSlice'; // 示例其他 reducer
import { FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';

// 持久化配置
const persistConfig = {
  key: 'root',
  storage,
};

// 合并 reducer
const rootReducer = combineReducers({
  user: userReducer, // 确保 userReducer 被包含
  counter: counterReducer, // 示例其他 reducer
});

// 包裹持久化 reducer
const persistedReducer = persistReducer(persistConfig, rootReducer);

// 配置 Redux store
export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

// 定义类型
export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
