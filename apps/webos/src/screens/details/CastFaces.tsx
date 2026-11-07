import { type TmdbPerson, tmdbImageUrl } from '@bannertv/core';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useTranslation } from 'react-i18next';
import { currentSection, openSection, push } from '../../app/router';
import { Artwork } from '../../components/Artwork';
import { Pressable } from '../../components/Pressable';
import { searchFor } from '../search/SearchScreen';
import styles from './DetailsScreen.module.css';

/**
 * The cast's faces under the buttons, each opening Search on the name, which
 * answers a full name with a row of their films and series. One focus group
 * as wide as the page's left side, so Right from the last button goes across
 * to the episodes rather than down to a face, and Down from the buttons comes
 * in on the face last focused, else the first.
 */
export function CastFaces({
  faces,
  onFocus,
}: {
  faces: readonly TmdbPerson[];
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLUListElement>({
    focusKey: 'details-cast',
    saveLastFocusedChild: true,
  });
  return (
    <FocusContext.Provider value={focusKey}>
      <ul ref={ref} className={styles.cast} aria-label={t('details.castTitle')}>
        {faces.map((person, index) => (
          <li key={index} className={styles.personSlot}>
            <Pressable
              focusKey={`details-cast-${index}`}
              label={t('browsing.searchPerson', { name: person.name })}
              className={styles.person}
              focusedClassName={styles.personFocused}
              onFocus={onFocus}
              onPress={() => {
                searchFor(person.name);
                // Over Search itself, that Search shows it: a second would clash with it.
                if (currentSection() === 'search') openSection('search');
                else push({ name: 'search' });
              }}
            >
              <Artwork
                src={tmdbImageUrl(person.profilePath, 'w185')}
                className={styles.face}
                fallback={<span className={styles.face} />}
              />
              <span className={styles.personName}>{person.name}</span>
            </Pressable>
          </li>
        ))}
      </ul>
    </FocusContext.Provider>
  );
}
