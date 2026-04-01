import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://nladygjdwmgxkiexieuc.supabase.co";

const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sYWR5Z2pkd21neGtpZXhpZXVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4Nzc0OTAsImV4cCI6MjA4OTQ1MzQ5MH0.8zo8dbiLKEVGs4Vz18nj_s_6fZa-OpJImjLecNR1EQY";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
