import { createStore } from '@bannertv/core';
import { Text, View } from 'react-native';

const greeting = createStore('BannerTV');

export default function Home() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0B0815',
      }}
    >
      <Text style={{ color: '#F1EDFF' }}>{greeting.get()}</Text>
    </View>
  );
}
