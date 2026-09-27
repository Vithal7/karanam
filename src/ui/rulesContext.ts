import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { bundledRules, type Rules } from '../rules';

/** The tax and statutory rules currently in force (bundled or downloaded). */
export const RulesContext = createContext<Rules>(bundledRules);
export const useRules = () => useContext(RulesContext);
