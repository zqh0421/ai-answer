'use client'; // 页面本身需要使用客户端组件

import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '@/app/store/store';
import { increment, decrement, reset, setCounter } from '../slices/couterSlice';

export default function CounterPage() {
  const count = useSelector((state: RootState) => state.counter.value);
  const dispatch = useDispatch<AppDispatch>();

  return (
    <div>
      <h1>Counter: {count}</h1>
      <button onClick={() => dispatch(increment())}>Increment</button>
      <button onClick={() => dispatch(decrement())}>Decrement</button>
      <button onClick={() => dispatch(reset())}>Reset</button>
      <button onClick={() => dispatch(setCounter(10))}>Set to 10</button>
    </div>
  );
}
