import { startAddons } from '@tv/data/addons';
import { startLibraryData } from '@tv/data/library';
import { startPlaybackData } from '@tv/data/playback';
import { activeProfileId } from '@tv/data/profiles';
import { accountState, startSync } from '@tv/data/sync';
import { startTrakt } from '@tv/data/trakt';
import { Text, View } from 'react-native';

startAddons();
startPlaybackData();
startLibraryData();
startTrakt();
startSync();

export default function Home() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#F1EDFF' }}>
        {String(activeProfileId.get())} {JSON.stringify(accountState.get())}
      </Text>
    </View>
  );
}
